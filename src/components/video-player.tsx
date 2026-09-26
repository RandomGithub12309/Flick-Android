import { useEffect, useRef } from "react";
import type { FlickVideo } from "@/lib/reddit/types";

type Props = {
  video: FlickVideo;
  active: boolean;
  muted: boolean;
  onProgress?: (ratio: number) => void;
};

export function VideoPlayer({ video, active, muted, onProgress }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

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
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("seeked", sync);
    };
  }, [onProgress, video.audioUrl]);

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
