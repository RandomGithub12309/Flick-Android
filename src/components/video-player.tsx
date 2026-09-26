import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Play } from "lucide-react";
import type { FlickVideo } from "@/lib/reddit/types";
import { cn, containRect, isLandscapeRatio, mediaRatio } from "@/lib/utils";

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

/** Once playing, this long with no `timeupdate` means the stream is wedged. */
const STALL_AFTER_MS = 15_000;

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
  playbackRate: number;
  /** Still frame used as a blurred fill behind letterboxed landscape clips. */
  poster?: string;
  onProgress?: (info: PlaybackInfo) => void;
  /** Fired once per activation when this video can't be played at all. */
  onUnplayable?: () => void;
};

export const VideoPlayer = forwardRef<VideoHandle, Props>(function VideoPlayer(
  { video, active, muted, playbackRate, poster, onProgress, onUnplayable },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const startTimer = useRef<number | null>(null);
  const stallCheck = useRef<number | null>(null);
  const reported = useRef(false);
  const started = useRef(false);
  const lastTick = useRef(0);
  const [blocked, setBlocked] = useState(false);
  const [native, setNative] = useState({ w: video.width, h: video.height });
  const [measured, setMeasured] = useState(false);
  const [frame, setFrame] = useState({ w: 0, h: 0 });

  const clearTimers = useCallback(() => {
    if (startTimer.current !== null) window.clearTimeout(startTimer.current);
    if (stallCheck.current !== null) window.clearInterval(stallCheck.current);
    startTimer.current = null;
    stallCheck.current = null;
  }, []);

  const reportUnplayable = useCallback(() => {
    if (reported.current) return;
    reported.current = true;
    clearTimers();
    onUnplayable?.();
  }, [clearTimers, onUnplayable]);

  useEffect(() => {
    setNative({ w: video.width, h: video.height });
    setMeasured(false);
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
      started.current = true;
      lastTick.current = performance.now();
      setBlocked(false);
      if (startTimer.current !== null) {
        window.clearTimeout(startTimer.current);
        startTimer.current = null;
      }
    };

    const onTime = () => {
      syncAudio();
      lastTick.current = performance.now();
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
      on("error", reportUnplayable),
    ];
    return () => offs.forEach((off) => off());
  }, [onProgress, reportUnplayable, video.audioUrl]);

  useEffect(() => {
    const el = videoRef.current;
    const audio = audioRef.current;
    if (!el) return;
    el.muted = muted;
    if (audio) audio.muted = muted;
    if (!active) {
      el.pause();
      audio?.pause();
      setBlocked(false);
      return;
    }
    void el.play().then(
      () => setBlocked(false),
      (err: unknown) => {
        // Autoplay refused: the media is fine, the browser just wants a
        // gesture first. Ask for one rather than skipping a good post.
        if ((err as { name?: string } | null)?.name === "NotAllowedError") {
          setBlocked(true);
        }
      },
    );
  }, [active, muted, video.url]);

  // Only the active slide judges itself — otherwise every offscreen video
  // would report itself dead the moment its metadata failed to load.
  useEffect(() => {
    if (!active) {
      clearTimers();
      return;
    }
    reported.current = false;
    started.current = false;
    lastTick.current = performance.now();

    startTimer.current = window.setTimeout(() => {
      startTimer.current = null;
      if (!started.current) reportUnplayable();
    }, START_GRACE_MS);

    stallCheck.current = window.setInterval(() => {
      if (!started.current) return;
      if (performance.now() - lastTick.current > STALL_AFTER_MS) reportUnplayable();
    }, 2000);

    return () => clearTimers();
  }, [active, clearTimers, reportUnplayable, video.url]);

  useEffect(() => {
    const el = videoRef.current;
    const audio = audioRef.current;
    if (!el) return;
    el.playbackRate = playbackRate;
    if (audio) audio.playbackRate = playbackRate;
  }, [playbackRate, video.audioUrl, video.url]);

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
        src={video.url}
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
              () => setBlocked(false),
              () => undefined,
            );
          }}
        >
          <span className="flex size-16 items-center justify-center rounded-full bg-fg/15 text-fg backdrop-blur-sm">
            <Play className="size-7 translate-x-0.5" fill="currentColor" />
          </span>
        </button>
      ) : null}
      {video.audioUrl ? (
        <audio ref={audioRef} src={video.audioUrl} loop preload={active ? "auto" : "none"} />
      ) : null}
    </div>
  );
});
