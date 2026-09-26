import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  onProgress?: (ratio: number) => void;
  /** Fired once per activation when this video can't be played at all. */
  onUnplayable?: () => void;
  /**
   * Fired when the browser refused to start playback with sound (autoplay
   * policy). The video keeps playing muted so the feed doesn't skip it, and
   * the sound button reflects reality again.
   */
  onAutoplayBlocked?: () => void;
};

/** Autoplay with sound is a browser permission, not a media-availability problem. */
function isAutoplayBlocked(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotAllowedError";
}

export function VideoPlayer({
  video,
  active,
  muted,
  onProgress,
  onUnplayable,
  onAutoplayBlocked,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const watchdog = useRef<number | null>(null);
  const reported = useRef(false);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [audioIndex, setAudioIndex] = useState(0);

  /** The preferred file, then whatever the host can offer instead. */
  const sources = useMemo(() => {
    const list = [video.url, video.fallbackUrl].filter((url): url is string => Boolean(url));
    return [...new Set(list)];
  }, [video.fallbackUrl, video.url]);
  const source = sources[sourceIndex];

  /** Reddit renames its audio files, so try each known URL before giving up. */
  const audioUrls = useMemo(() => {
    const list = video.audioUrls?.length ? video.audioUrls : video.audioUrl ? [video.audioUrl] : [];
    return [...new Set(list)];
  }, [video.audioUrl, video.audioUrls]);

  const audioUrl = audioUrls[audioIndex];

  const reportUnplayable = useCallback(() => {
    if (reported.current) return;
    reported.current = true;
    onUnplayable?.();
  }, [onUnplayable]);

  /** Swaps in the next source, or reports that there is nothing left to try. */
  const advanceSource = useCallback(() => {
    if (sourceIndex + 1 >= sources.length) return false;
    setSourceIndex(sourceIndex + 1);
    return true;
  }, [sourceIndex, sources.length]);

  const armWatchdog = useCallback(() => {
    if (watchdog.current !== null) window.clearTimeout(watchdog.current);
    watchdog.current = window.setTimeout(() => {
      const el = videoRef.current;
      // HAVE_FUTURE_DATA (3) or better means there is decodable media to show.
      const playing = el && el.readyState >= 3 && !el.paused;
      // A source that hangs without erroring gets one swap too — a stalled CDN
      // and a dead file look identical from here.
      if (!playing && !advanceSource()) reportUnplayable();
    }, UNPLAYABLE_AFTER_MS);
  }, [advanceSource, reportUnplayable]);

  const handleVideoError = useCallback(() => {
    if (!advanceSource()) reportUnplayable();
  }, [advanceSource, reportUnplayable]);

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

    const playAudio = () => {
      if (!audio) return;
      void audio.play().catch((error: unknown) => {
        if (isAutoplayBlocked(error)) onAutoplayBlocked?.();
      });
    };

    const onPlay = () => {
      playAudio();
    };
    const onPause = () => {
      audio?.pause();
    };
    const onTime = () => {
      sync();
      if (el.duration > 0) onProgress?.(el.currentTime / el.duration);
    };
    // The audio file starts at 0, so joining a video mid-playback (a fresh
    // source, a swapped-in fallback) needs an explicit jump.
    const onLoadedAudio = () => {
      sync();
      if (!el.paused) playAudio();
    };

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("seeked", sync);
    el.addEventListener("error", handleVideoError);
    audio?.addEventListener("loadedmetadata", onLoadedAudio);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("seeked", sync);
      el.removeEventListener("error", handleVideoError);
      audio?.removeEventListener("loadedmetadata", onLoadedAudio);
    };
  }, [handleVideoError, onAutoplayBlocked, onProgress, audioUrl, source]);

  // A bad guess at the audio file name must not mark the video unplayable —
  // move on to the next candidate instead.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onAudioError = () => {
      setAudioIndex((index) => (index + 1 < audioUrls.length ? index + 1 : index));
    };
    audio.addEventListener("error", onAudioError);
    return () => audio.removeEventListener("error", onAudioError);
  }, [audioUrls.length, audioUrl]);

  useEffect(() => {
    setSourceIndex(0);
    setAudioIndex(0);
  }, [video.url]);

  useEffect(() => {
    const el = videoRef.current;
    const audio = audioRef.current;
    if (!el) return;
    el.muted = muted;
    if (audio) audio.muted = muted;
    if (!active) {
      el.pause();
      audio?.pause();
      return;
    }
    void el.play().catch((error: unknown) => {
      if (!isAutoplayBlocked(error)) return;
      // Playback with sound needs a real gesture on some browsers (and the
      // desktop web build has no native shell to lift that). Play muted rather
      // than skipping, and let the sound button tell the truth.
      onAutoplayBlocked?.();
      el.muted = true;
      if (audio) audio.muted = true;
      void el.play().catch(() => undefined);
    });
  }, [active, muted, onAutoplayBlocked, audioUrl, source]);

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
  }, [active, armWatchdog, source, video.url]);

  return (
    <>
      <video
        ref={videoRef}
        src={source}
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
      {audioUrl ? (
        <audio ref={audioRef} src={audioUrl} loop preload={active ? "auto" : "none"} />
      ) : null}
    </>
  );
}
