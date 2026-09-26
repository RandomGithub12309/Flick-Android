import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Link2 } from "lucide-react";
import type { FlickPost } from "@/lib/reddit/types";
import { SeekBar } from "@/components/seek-bar";
import { VideoPlayer } from "@/components/video-player";
import type { PlaybackInfo, VideoHandle } from "@/components/video-player";
import { cn, formatScore } from "@/lib/utils";

type Props = {
  offset: number;
  drag: number;
  animating: boolean;
  onUnplayable?: () => void;
};

export function PostSlide({ post, active, muted, offset, drag, animating, onUnplayable }: Props) {
  const [playback, setPlayback] = useState<PlaybackInfo>({
    ratio: null,
    buffered: null,
    current: 0,
    duration: 0,
  });
  const [galleryIndex, setGalleryIndex] = useState(0);
  const videoRef = useRef<VideoHandle>(null);
  const gallery = post.gallery ?? [];
  const image =
    post.kind === "gallery" ? (gallery[galleryIndex] ?? post.image) : post.image;
    >
      {post.kind === "video" && post.video ? (
        <VideoPlayer
          ref={videoRef}
          video={post.video}
          active={active}
          muted={muted}
          onProgress={setPlayback}
          onUnplayable={onUnplayable}
        />
      ) : image ? (
        <img

      <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-bg/80 via-transparent to-bg/35" />

      {post.kind === "gallery" && gallery.length > 1 ? (
        <div className="absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 justify-between px-2">
          <button
      ) : null}

      <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-safe pt-16">
        {/* Only the active slide gets the control — three overlapping
            scrubbers would fight each other for the same gesture. */}
        {post.kind === "video" && active ? (
          <SeekBar
            ratio={playback.ratio}
            buffered={playback.buffered}
            current={playback.current}
            duration={playback.duration}
            onSeek={(ratio) => videoRef.current?.seek(ratio)}
          />
        ) : null}
        <div className="max-w-xs pb-6 pr-4">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
            <span className="rounded-full bg-fg/12 px-2.5 py-1">r/{post.subreddit}</span>
