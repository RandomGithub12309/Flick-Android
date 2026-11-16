import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2, Pause, Play } from "lucide-react";
import type { FlickVideo } from "@/lib/reddit/types";
import {
  effectiveDuration,
  shouldSkipDeadVideo,
  type VideoFailureReason,
} from "@/lib/video-playing";
import { audioUrlsForSource, videoSources } from "@/lib/video-sources";

/** End of the seekable window, or null when the browser reports none. */
function seekableEndOf(el: HTMLMediaElement): number | null {
  try {
    const { seekable } = el;
    if (seekable.length === 0) return null;
    const end = seekable.end(seekable.length - 1);
    return Number.isFinite(end) ? end : null;
  } catch {
    return null;
  }
}

/**
 * How long the active video gets to actually start before we skip it.
 */
const START_GRACE_MS = 10_000;

export type PlaybackInfo = {
  /** 0..1 through the timeline, or null until the duration is known. */
  ratio: number | null;
  /** 0..1 buffered ahead of the playhead, or null when unknown. */
  buffered: number | null;
  current: number;
  duration: number;
};

export type VideoHandle = {
  /** Jump to `ratio` (0..1) of the timeline. A no-op until the duration is known. */
  seek: (ratio: number) => void;
  /** Jump relative by `deltaSeconds` (e.g. -5 or +5). */
  seekBy: (deltaSeconds: number) => void;
  /** Set playback speed (e.g. 1 or 2 for hold-to-2x). */
  setPlaybackRate: (rate: number) => void;
  /** Toggle pause/play on user tap. */
  togglePlay: () => void;
};

type Props = {
  video: FlickVideo;
  active: boolean;
  preload?: boolean;
  muted: boolean;
  autoAdvance?: boolean;
  /** Still frame shown behind the video as a blurred backdrop. */
  poster?: string;
  /** Hide playback UI while leaving the video itself visible. */
  uiVisible?: boolean;
  onProgress?: (info: PlaybackInfo) => void;
  /** Fired once per activation when this video can't be played at all. */
  onUnplayable?: () => void;
  /** Fired when the video finishes playing and `autoAdvance` is enabled. */
  onEnded?: () => void;
};

export const VideoPlayer = forwardRef<VideoHandle, Props>(function VideoPlayer(
  {
    video,
    active,
    preload = false,
    muted,
    autoAdvance = false,
    poster,
    uiVisible = true,
    onProgress,
    onUnplayable,
    onEnded,
  },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const startTimer = useRef<number | null>(null);
  const flashTimer = useRef<number | null>(null);
  const reported = useRef(false);
  const activeRef = useRef(active);
  const blockedRef = useRef(false);
  const userPausedRef = useRef(false);
  const onUnplayableRef = useRef(onUnplayable);
  activeRef.current = active;
  onUnplayableRef.current = onUnplayable;

  const [blocked, setBlocked] = useState(false);
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [flashIcon, setFlashIcon] = useState<"play" | "pause" | null>(null);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [audioIndex, setAudioIndex] = useState(0);
  /** Which sidecar URL was explicitly started; a mute toggle must not reload it. */
  const startedAudioSrc = useRef<string | null>(null);

  const sources = useMemo(() => videoSources(video), [video]);
  const source = sources[sourceIndex];
  const isFallbackSource = sourceIndex > 0;

  const audioUrls = useMemo(
    () => audioUrlsForSource(video, isFallbackSource),
    [video, isFallbackSource],
  );
  const audioUrl = audioUrls[audioIndex];
  const audioKey = audioUrls.join("|");
  useEffect(() => {
    setAudioIndex(0);
  }, [audioKey]);

  const clearStartTimer = useCallback(() => {
    if (startTimer.current !== null) window.clearTimeout(startTimer.current);
    startTimer.current = null;
  }, []);

  const showFlash = useCallback((kind: "play" | "pause") => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    setFlashIcon(kind);
    flashTimer.current = window.setTimeout(() => {
      flashTimer.current = null;
      setFlashIcon(null);
    }, 550);
  }, []);

  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    };
  }, []);

  const reportUnplayable = useCallback(
    (reason: VideoFailureReason) => {
      if (userPausedRef.current) return;
      if (
        !shouldSkipDeadVideo({
          active: activeRef.current,
          blocked: blockedRef.current,
          reported: reported.current,
          video: videoRef.current,
          reason,
        })
      ) {
        return;
      }
      reported.current = true;
      clearStartTimer();
      onUnplayableRef.current?.();
    },
    [clearStartTimer],
  );

  const advanceSource = useCallback(() => {
    if (sourceIndex + 1 >= sources.length) return false;
    setSourceIndex(sourceIndex + 1);
    return true;
  }, [sourceIndex, sources.length]);

  useEffect(() => {
    setSourceIndex(0);
    setAudioIndex(0);
    userPausedRef.current = false;
    setPaused(false);
    setBuffering(false);
  }, [video.url, video.width, video.height]);

  useImperativeHandle(
    ref,
    () => ({
      seek(ratio: number) {
        const el = videoRef.current;
        if (!el) return;
        const duration = effectiveDuration(el.duration, seekableEndOf(el));
        if (duration <= 0) return;
        const time = Math.min(1, Math.max(0, ratio)) * duration;
        el.currentTime = time;
        try {
          if (audioRef.current) audioRef.current.currentTime = time;
        } catch {
          // The timeupdate sync pulls it back in line once it can seek.
        }
      },
      seekBy(deltaSeconds: number) {
        const el = videoRef.current;
        if (!el) return;
        const duration = effectiveDuration(el.duration, seekableEndOf(el));
        const max = duration > 0 ? duration : el.currentTime + Math.max(0, deltaSeconds);
        const time = Math.min(max, Math.max(0, el.currentTime + deltaSeconds));
        el.currentTime = time;
        try {
          if (audioRef.current) audioRef.current.currentTime = time;
        } catch {
          // Ignore seek error before metadata
        }
      },
      setPlaybackRate(rate: number) {
        const el = videoRef.current;
        if (!el) return;
        el.playbackRate = rate;
        if (audioRef.current) audioRef.current.playbackRate = rate;
      },
      togglePlay() {
        const el = videoRef.current;
        const audio = audioRef.current;
        if (!el || !activeRef.current) return;
        if (el.paused) {
          userPausedRef.current = false;
          setPaused(false);
          showFlash("play");
          void el.play().then(
            () => {
              if (audio && !muted) void audio.play().catch(() => undefined);
            },
            () => undefined,
          );
        } else {
          userPausedRef.current = true;
          setPaused(true);
          showFlash("pause");
          el.pause();
          audio?.pause();
        }
      },
    }),
    [muted, showFlash],
  );

  useEffect(() => {
    const el = videoRef.current;
    const audio = audioRef.current;
    if (!el) return;

    const syncAudio = () => {
      if (!audio) return;
      if (Math.abs(el.currentTime - audio.currentTime) > 0.25) {
        audio.currentTime = el.currentTime;
      }
    };

    const publish = () => {
      const duration = effectiveDuration(el.duration, seekableEndOf(el));
      let buffered: number | null = null;
      if (duration > 0 && el.buffered.length > 0) {
        try {
          buffered = el.buffered.end(el.buffered.length - 1) / duration;
        } catch {
          buffered = null;
        }
      }
      onProgress?.({
        ratio: duration > 0 ? el.currentTime / duration : null,
        buffered,
        current: el.currentTime,
        duration,
      });
    };

    const onPlaying = () => {
      blockedRef.current = false;
      setBlocked(false);
      setBuffering(false);
      clearStartTimer();
    };

    const onWaiting = () => {
      if (activeRef.current && !userPausedRef.current) setBuffering(true);
    };

    const onCanPlay = () => {
      setBuffering(false);
    };

    const onTime = () => {
      syncAudio();
      publish();
    };

    const on = (type: string, fn: EventListener) => {
      el.addEventListener(type, fn);
      return () => el.removeEventListener(type, fn);
    };

    const offs = [
      on("play", () => {
        if (!userPausedRef.current) void audio?.play().catch(() => undefined);
      }),
      on("pause", () => audio?.pause()),
      on("playing", onPlaying),
      on("waiting", onWaiting),
      on("canplay", onCanPlay),
      on("timeupdate", onTime),
      on("progress", publish),
      on("durationchange", publish),
      on("loadedmetadata", publish),
      on("seeked", () => {
        syncAudio();
        publish();
      }),
      on("ended", () => {
        if (activeRef.current && autoAdvance) onEnded?.();
      }),
      on("error", () => {
        if (!advanceSource()) reportUnplayable("error");
      }),
    ];

    const onLoadedAudio = () => {
      if (!audio) return;
      syncAudio();
      if (!el.paused) void audio.play().catch(() => undefined);
    };
    audio?.addEventListener("loadedmetadata", onLoadedAudio);

    return () => {
      offs.forEach((off) => off());
      audio?.removeEventListener("loadedmetadata", onLoadedAudio);
    };
  }, [advanceSource, audioUrl, autoAdvance, clearStartTimer, onEnded, onProgress, reportUnplayable, source]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onAudioError = () => {
      setAudioIndex((index) => (index + 1 < audioUrls.length ? index + 1 : index));
    };
    audio.addEventListener("error", onAudioError);
    return () => audio.removeEventListener("error", onAudioError);
  }, [audioUrl, audioUrls.length]);

  useEffect(() => {
    const el = videoRef.current;
    const audio = audioRef.current;
    if (!el) return;
    el.muted = muted;
    el.volume = 1;
    if (audio) {
      audio.muted = muted;
      audio.volume = 1;
    }
    if (!active) {
      el.pause();
      el.playbackRate = 1;
      audio?.pause();
      if (audio) audio.playbackRate = 1;
      blockedRef.current = false;
      userPausedRef.current = false;
      setBlocked(false);
      setPaused(false);
      setBuffering(false);
      return;
    }
    if (audio && audioUrl && startedAudioSrc.current !== audioUrl) {
      startedAudioSrc.current = audioUrl;
      try {
        audio.load();
      } catch {
        // Ignore redundant load error
      }
    }
    if (userPausedRef.current) return;
    void el.play().then(
      () => {
        blockedRef.current = false;
        setBlocked(false);
        if (audio && !muted) void audio.play().catch(() => undefined);
      },
      (err: unknown) => {
        if ((err as { name?: string } | null)?.name === "NotAllowedError") {
          blockedRef.current = true;
          setBlocked(true);
        }
      },
    );
  }, [active, audioUrl, muted, source, video.url]);

  // Keep screen awake while an active video is playing.
  useEffect(() => {
    if (!active || paused) return;
    let wakeLock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    nav.wakeLock
      ?.request("screen")
      .then((lock) => {
        wakeLock = lock;
      })
      .catch(() => {});
    return () => {
      void wakeLock?.release().catch(() => {});
    };
  }, [active, paused]);

  // Pause playback when app goes to background.
  useEffect(() => {
    if (!active) return;
    const onVisibility = () => {
      if (document.hidden) {
        videoRef.current?.pause();
        audioRef.current?.pause();
      } else if (!userPausedRef.current && activeRef.current) {
        void videoRef.current?.play().catch(() => undefined);
        if (audioRef.current && !muted) void audioRef.current.play().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [active, muted]);

  useEffect(() => {
    if (!active) {
      clearStartTimer();
      return;
    }
    reported.current = false;
    blockedRef.current = false;
    setBlocked(false);

    startTimer.current = window.setTimeout(() => {
      startTimer.current = null;
      if (!advanceSource()) reportUnplayable("start-timeout");
    }, START_GRACE_MS);

    return () => clearStartTimer();
  }, [active, advanceSource, clearStartTimer, reportUnplayable, video.url]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {poster ? (
        <img
          src={poster}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute inset-0 size-full object-cover opacity-40 blur-2xl scale-110"
        />
      ) : null}
      <video
        ref={videoRef}
        src={source}
        poster={poster}
        playsInline
        loop={!autoAdvance}
        autoPlay={active}
        muted={muted}
        preload={active || preload ? "auto" : "metadata"}
        className="absolute inset-0 size-full bg-black object-contain"
      />
      {buffering && active && !paused && !blocked ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-bg/55 text-fg backdrop-blur-sm">
            <Loader2 className="size-6 animate-spin" />
          </span>
        </div>
      ) : null}
      {flashIcon || (paused && active) ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-bg/55 text-fg backdrop-blur-sm">
            {paused || flashIcon === "pause" ? (
              <Pause className="size-7" fill="currentColor" />
            ) : (
              <Play className="size-7 translate-x-0.5" fill="currentColor" />
            )}
          </span>
        </div>
      ) : null}
      {blocked && uiVisible ? (
        <button
          type="button"
          aria-label="Play video"
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/40"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            const el = videoRef.current;
            const audio = audioRef.current;
            if (!el) return;
            userPausedRef.current = false;
            setPaused(false);
            void el.play().then(
              () => {
                blockedRef.current = false;
                setBlocked(false);
                if (audio && !muted) void audio.play().catch(() => undefined);
              },
              () => undefined,
            );
          }}
        >
          <span className="flex size-16 items-center justify-center rounded-full bg-fg/15 text-fg backdrop-blur-sm">
            <Play className="size-7 translate-x-0.5" fill="currentColor" />
          </span>
        </button>
      ) : null}
      {audioUrl ? (
        <audio
          ref={audioRef}
          src={audioUrl}
          loop={!autoAdvance}
          preload={active || preload ? "auto" : "none"}
        />
      ) : null}
    </div>
  );
});
