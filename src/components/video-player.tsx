import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Play } from "lucide-react";
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
 * How long the active video gets to actually start before we write it off.
 *
 * This used to be 8s and it also counted `el.paused` as a failure, which
 * discarded videos that were perfectly watchable. A browser that refuses
 * autoplay leaves `play()` rejected and the element paused indefinitely —
 * indistinguishable from dead media at 8s — and a slow connection can hold
 * `readyState` below 3 well past that. So start-up is judged only on whether
 * playback actually began, over a much longer window, and a blocked autoplay
 * becomes a tap-to-play prompt instead of a skip.
 */
const START_GRACE_MS = 20_000;

export type PlaybackInfo = {
  /** 0..1 through the timeline, or null until the duration is known. */
  ratio: number | null;
  /** 0..1 buffered ahead of the playhead, or null when the browser won't say. */
  buffered: number | null;
  current: number;
  duration: number;
};

export type VideoHandle = {
  /** Jump to `ratio` (0..1) of the timeline. A no-op until the duration is known. */
  seek: (ratio: number) => void;
};

type Props = {
  video: FlickVideo;
  active: boolean;
  muted: boolean;
  /** Still frame shown behind the video as a blurred backdrop. */
  poster?: string;
  /** Hide playback UI while leaving the video itself visible. */
  uiVisible?: boolean;
  onProgress?: (info: PlaybackInfo) => void;
  /** Fired once per activation when this video can't be played at all. */
  onUnplayable?: () => void;
};

export const VideoPlayer = forwardRef<VideoHandle, Props>(function VideoPlayer(
  { video, active, muted, poster, uiVisible = true, onProgress, onUnplayable },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const startTimer = useRef<number | null>(null);
  const reported = useRef(false);
  const activeRef = useRef(active);
  const blockedRef = useRef(false);
  const onUnplayableRef = useRef(onUnplayable);
  activeRef.current = active;
  onUnplayableRef.current = onUnplayable;
  const [blocked, setBlocked] = useState(false);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [audioIndex, setAudioIndex] = useState(0);
  /** Which sidecar URL was explicitly started; a mute toggle must not reload it. */
  const startedAudioSrc = useRef<string | null>(null);

  /**
   * The preferred file first, then whatever else the post can play — a redgifs
   * clip carries Reddit's own copy as `fallbackUrl`, for networks where the
   * redgifs CDN is blocked.
   */
  const sources = useMemo(() => videoSources(video), [video]);
  const source = sources[sourceIndex];
  const isFallbackSource = sourceIndex > 0;

  /**
   * Reddit renames its audio files, so try each known URL before giving up.
   * The list follows the source: a redgifs mp4 has its sound already, and the
   * sidecar belongs to the fallback it just failed over to.
   */
  const audioUrls = useMemo(
    () => audioUrlsForSource(video, isFallbackSource),
    [video, isFallbackSource],
  );
  const audioUrl = audioUrls[audioIndex];
  // Falling back swaps which file the sound comes from, so a candidate index
  // that made sense for the previous source is meaningless against the new one.
  const audioKey = audioUrls.join("|");
  useEffect(() => {
    setAudioIndex(0);
  }, [audioKey]);

  const clearStartTimer = useCallback(() => {
    if (startTimer.current !== null) window.clearTimeout(startTimer.current);
    startTimer.current = null;
  }, []);

  const reportUnplayable = useCallback(
    (reason: VideoFailureReason) => {
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

  /**
   * Swap in the next source for this post, or report that there is nothing
   * left to try. Returns whether a different file is now loading.
   */
  const advanceSource = useCallback(() => {
    if (sourceIndex + 1 >= sources.length) return false;
    setSourceIndex(sourceIndex + 1);
    return true;
  }, [sourceIndex, sources.length]);

  useEffect(() => {
    setSourceIndex(0);
    setAudioIndex(0);
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
        // The sidecar may not have metadata yet — setting currentTime then
        // throws, and must not take the video's seek down with it.
        try {
          if (audioRef.current) audioRef.current.currentTime = time;
        } catch {
          // The timeupdate sync pulls it back in line once it can seek.
        }
      },
    }),
    [],
  );

  useEffect(() => {
    const el = videoRef.current;
    const audio = audioRef.current;
    if (!el) return;

    const syncAudio = () => {
      if (!audio) return;
      if (Math.abs(el.currentTime - audio.currentTime) > 0.35) {
        audio.currentTime = el.currentTime;
      }
    };

    const publish = () => {
      // Fragmented uploads report Infinity/NaN duration; the seekable window
      // is the timeline then, and without it the seek bar stays disabled.
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
      clearStartTimer();
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
      on("play", () => void audio?.play().catch(() => undefined)),
      on("pause", () => audio?.pause()),
      on("playing", onPlaying),
      on("timeupdate", onTime),
      on("progress", publish),
      on("durationchange", publish),
      on("loadedmetadata", publish),
      on("seeked", () => {
        syncAudio();
        publish();
      }),
      on("error", () => {
        if (!advanceSource()) reportUnplayable("error");
      }),
    ];

    // The audio file starts at 0, so joining a video that is already playing
    // (a swapped-in candidate, a fallback source) needs an explicit jump.
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
  }, [advanceSource, audioUrl, clearStartTimer, onProgress, reportUnplayable, source]);

  // A wrong guess at Reddit's audio file name must not write the post off —
  // move on to the next candidate instead. The video keeps playing silently in
  // the meantime, which beats skipping a post that is otherwise fine.
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
      audio?.pause();
      blockedRef.current = false;
      setBlocked(false);
      return;
    }
    // The sidecar starts explicitly with the picture — not just off the
    // video's `play` event. Flipping `preload` from "none" does not reliably
    // kick off a load on its own, and a sidecar that never loads is a video
    // that plays silent with no error ever firing. Each URL loads once: this
    // effect also runs on mute toggles, and those must not restart the audio.
    if (audio && audioUrl && startedAudioSrc.current !== audioUrl) {
      startedAudioSrc.current = audioUrl;
      try {
        audio.load();
      } catch {
        // A redundant load() is harmless; a missing one is silence.
      }
    }
    void el.play().then(
      () => {
        blockedRef.current = false;
        setBlocked(false);
        if (audio && !muted) void audio.play().catch(() => undefined);
      },
      (err: unknown) => {
        // Autoplay refused: the media is fine, the browser just wants a
        // gesture first. Ask for one rather than skipping a good post.
        if ((err as { name?: string } | null)?.name === "NotAllowedError") {
          blockedRef.current = true;
          setBlocked(true);
        }
      },
    );
  }, [active, audioUrl, muted, source, video.url]);

  // Only the active slide judges itself. Keep the grace timer tied to slide
  // activation, not callback/render changes, so a watchdog re-arm cannot make
  // a video that is already playing look like it never started.
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
      // A source that stalls and a file that is dead look identical from here,
      // so the fallback gets one chance before the post is written off.
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
      {/*
        Always contained: the whole frame stays visible on every screen shape.
        Cover-cropping "portrait" clips sliced heads on wide viewports, and any
        mismatch between the tagged dimensions and the real file cropped blind.
        On a phone a portrait clip still fills the frame — containment only
        shows its bars when the aspects actually disagree.
      */}
      <video
        ref={videoRef}
        src={source}
        poster={poster}
        playsInline
        loop
        autoPlay={active}
        muted={muted}
        preload={active ? "auto" : "metadata"}
        className="absolute inset-0 size-full bg-black object-contain"
      />
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
            void el.play().then(
              () => {
                blockedRef.current = false;
                setBlocked(false);
                // A real gesture: start the sidecar here too, not just the
                // picture, or the tap buys video with no sound.
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
        <audio ref={audioRef} src={audioUrl} loop preload={active ? "auto" : "none"} />
      ) : null}
    </div>
  );
});
