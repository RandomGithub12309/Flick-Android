import { useCallback, useEffect, useRef } from "react";
import type { FlickVideo } from "@/lib/reddit/types";

/**
 * A video is treated as unplayable if it errors, or if it hasn't actually
 * started after this long. Reddit serves a lot of dead `v.redd.it` and
 * redgifs links (404, geo-blocked, removed), and those would otherwise sit on
 * screen as a frozen frame forever.
 */
const UNPLAYABLE_AFTER_MS = 8000;

type Props = {
  video: FlickVideo;
  active: boolean;
  muted: boolean;
  playbackRate: number;
  onProgress?: (ratio: number) => void;
  /** Fired once per activation when this video can't be played at all. */
  onUnplayable?: () => void;
};

export function VideoPlayer({
  video,
  active,
  muted,
  playbackRate,
  onProgress,
  onUnplayable,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const watchdog = useRef<number | null>(null);
  const reported = useRef(false);

  const reportUnplayable = useCallback(() => {
    if (reported.current) return;
    reported.current = true;
    onUnplayable?.();
  }, [onUnplayable]);

  const armWatchdog = useCallback(() => {
    if (watchdog.current !== null) window.clearTimeout(watchdog.current);
    watchdog.current = window.setTimeout(() => {
      const el = videoRef.current;
      // HAVE_FUTURE_DATA (3) or better means there is decodable media to show.
      if (!el || el.readyState < 3 || el.paused) reportUnplayable();
    }, UNPLAYABLE_AFTER_MS);
  }, [reportUnplayable]);

  useEffect(() => {
    const el = videoRef.current;
    const audio = audioRef.current;
    if (!el) return;

    const sync = () => {
      if (!audio) return;
      if (Math.abs(el.currentTime - audio.currentTime) > 0.35) {
        audio.currentTime = el.currentTime;
      }
    };

    const onPlay = () => {
      void audio?.play().catch(() => undefined);
    };
    const onPause = () => {
      audio?.pause();
    };
    const onTime = () => {
      sync();
      if (el.duration > 0) onProgress?.(el.currentTime / el.duration);
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("seeked", sync);
    el.addEventListener("error", reportUnplayable);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("seeked", sync);
      el.removeEventListener("error", reportUnplayable);
    };
  }, [onProgress, reportUnplayable, video.audioUrl]);

  useEffect(() => {
    const el = videoRef.current;
    const audio = audioRef.current;
    if (!el) return;
    el.muted = muted;
    if (audio) audio.muted = muted;
    if (active) {
      const play = () => {
        void el.play().catch(() => undefined);
        if (audio && !muted) void audio.play().catch(() => undefined);
      };
      play();
    } else {
      el.pause();
      audio?.pause();
    }
  }, [active, muted, video.url]);

  // Only the active slide runs a watchdog — otherwise every offscreen video
  // would report itself unplayable the moment its metadata failed to load.
  useEffect(() => {
    if (!active) {
      if (watchdog.current !== null) {
        window.clearTimeout(watchdog.current);
        watchdog.current = null;
      }
      return;
    }
    reported.current = false;
    armWatchdog();
    return () => {
      if (watchdog.current !== null) {
        window.clearTimeout(watchdog.current);
        watchdog.current = null;
      }
    };
  }, [active, armWatchdog, video.url]);

  useEffect(() => {
    const el = videoRef.current;
    const audio = audioRef.current;
    if (!el) return;
    el.playbackRate = playbackRate;
    if (audio) audio.playbackRate = playbackRate;
  }, [playbackRate, video.audioUrl, video.url]);

  return (
    <>
      <video
        ref={videoRef}
        src={video.url}
        className="absolute inset-0 size-full object-cover"
        playsInline
        loop
        autoPlay={active}
        muted={muted}
        preload={active ? "auto" : "metadata"}
        onPlaying={() => {
          if (watchdog.current !== null) {
            window.clearTimeout(watchdog.current);
            watchdog.current = null;
          }
        }}
      />
      {video.audioUrl ? (
        <audio
          ref={audioRef}
          src={video.audioUrl}
          loop
          preload={active ? "auto" : "none"}
        />
      ) : null}
    </>
  );
}
