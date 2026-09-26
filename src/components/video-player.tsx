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
import { cn, containRect, isLandscapeRatio, mediaRatio } from "@/lib/utils";
import { shouldSkipDeadVideo, type VideoFailureReason } from "@/lib/video-playing";
import { audioUrlsForSource, videoSources } from "@/lib/video-sources";

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
  /** Still frame used as a blurred fill behind letterboxed landscape clips. */
  poster?: string;
  onProgress?: (info: PlaybackInfo) => void;
  /** Fired once per activation when this video can't be played at all. */
  onUnplayable?: () => void;
};

export const VideoPlayer = forwardRef<VideoHandle, Props>(function VideoPlayer(
  { video, active, muted, poster, onProgress, onUnplayable },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const startTimer = useRef<number | null>(null);
  const reported = useRef(false);
  const activeRef = useRef(active);
  const blockedRef = useRef(false);
  const onUnplayableRef = useRef(onUnplayable);
  activeRef.current = active;
  onUnplayableRef.current = onUnplayable;
  const [blocked, setBlocked] = useState(false);
  const [native, setNative] = useState({ w: video.width, h: video.height });
  const [measured, setMeasured] = useState(false);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [sourceIndex, setSourceIndex] = useState(0);
  const [audioIndex, setAudioIndex] = useState(0);

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
    setNative({ w: video.width, h: video.height });
    setMeasured(false);
    setSourceIndex(0);
    setAudioIndex(0);
  }, [video.url, video.width, video.height]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => setFrame({ w: stage.clientWidth, h: stage.clientHeight });
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [video.url]);

  const ratio = mediaRatio(native.w, native.h);
  // Until the element reports its size, letterbox — Reddit's fallback 720×1280
  // would otherwise cover-crop a landscape file into a thin centre strip.
  const letterbox = !measured || isLandscapeRatio(ratio) || ratio == null;
  const box =
    measured && letterbox && frame.w > 0 && native.w > 0 && native.h > 0
      ? containRect(frame.w, frame.h, native.w, native.h)
      : null;

  useImperativeHandle(
    ref,
    () => ({
      seek(ratio: number) {
        const el = videoRef.current;
        if (!el) return;
        const { duration } = el;
        if (!Number.isFinite(duration) || duration <= 0) return;
        const time = Math.min(1, Math.max(0, ratio)) * duration;
        el.currentTime = time;
        if (audioRef.current) audioRef.current.currentTime = time;
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
      const duration = Number.isFinite(el.duration) ? el.duration : 0;
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
      on("loadedmetadata", () => {
        if (el.videoWidth > 0 && el.videoHeight > 0) {
          setNative({ w: el.videoWidth, h: el.videoHeight });
          setMeasured(true);
        }
        publish();
      }),
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
    if (audio) audio.muted = muted;
    if (!active) {
      el.pause();
      audio?.pause();
      blockedRef.current = false;
      setBlocked(false);
      return;
    }
    void el.play().then(
      () => {
        blockedRef.current = false;
        setBlocked(false);
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
  }, [active, muted, source, video.url]);

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
    <div ref={stageRef} className="absolute inset-0 overflow-hidden bg-black">
      {letterbox && poster ? (
        <img
          src={poster}
          alt=""
          aria-hidden
          draggable={false}
          className="absolute inset-0 size-full object-cover opacity-70 blur-2xl scale-125"
        />
      ) : null}
      {/*
        Landscape on a portrait screen is sized to a contain-rect (the full
        frame, letterboxed) instead of object-cover, which sliced 16:9 clips
        down to a thin centre band. Portrait clips still bleed to the edges.
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
        style={
          box
            ? {
                position: "absolute",
                width: box.width,
                height: box.height,
                left: box.left,
                top: box.top,
              }
            : undefined
        }
        className={cn(
          "bg-black object-contain",
          box
            ? null
            : letterbox
              ? "absolute inset-0 size-full object-contain"
              : "absolute inset-0 size-full object-cover",
        )}
      />
      {blocked ? (
        <button
          type="button"
          aria-label="Play video"
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/40"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            const el = videoRef.current;
            if (!el) return;
            void el.play().then(
              () => {
                blockedRef.current = false;
                setBlocked(false);
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
