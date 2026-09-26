import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Link2 } from "lucide-react";
import type { FlickPost } from "@/lib/reddit/types";
import { SeekBar } from "@/components/seek-bar";
import { SpeedBar } from "@/components/speed-bar";
import { VideoPlayer } from "@/components/video-player";
import type { PlaybackInfo, VideoHandle } from "@/components/video-player";
import { useFlick } from "@/store/flick";
import { cn, formatScore, isLandscapeRatio, mediaRatio } from "@/lib/utils";

type Props = {
  post: FlickPost;
  active: boolean;
  muted: boolean;
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
  const playbackRate = useFlick((s) => s.playbackRate);
  const setPlaybackRate = useFlick((s) => s.setPlaybackRate);
  const gallery = post.gallery ?? [];
  const image =
    post.kind === "gallery" ? (gallery[galleryIndex] ?? post.image) : post.image;
  const poster = post.image?.url ?? post.thumbnail;
  const landscapeVideo = isLandscapeRatio(mediaRatio(post.video?.width, post.video?.height));
  const landscapeImage = isLandscapeRatio(mediaRatio(image?.width, image?.height));

  return (
    <article
      className={cn("absolute inset-0 overflow-hidden bg-bg", animating && "slide-anim")}
      style={{
        transform: `translate3d(0, calc(${offset * 100}% + ${drag}px), 0)`,
        willChange: "transform",
      }}
    >
      {post.kind === "video" && post.video ? (
        <VideoPlayer
          ref={videoRef}
          video={post.video}
          active={active}
          muted={muted}
          playbackRate={playbackRate}
          poster={poster}
          onProgress={setPlayback}
          onUnplayable={onUnplayable}
        />
      ) : image ? (
        <>
          {landscapeImage ? (
            <img
              src={image.url}
              alt=""
              aria-hidden
              draggable={false}
              className="absolute inset-0 size-full object-cover opacity-70 blur-2xl scale-125"
            />
          ) : null}
          <img
            src={image.url}
            alt={post.title}
            className={cn(
              "absolute inset-0 size-full outline outline-1 -outline-offset-1 outline-fg/10",
              landscapeImage ? "object-contain" : "object-cover",
            )}
            draggable={false}
          />
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col justify-end bg-surface px-5 pb-32 pt-safe">
          <div className="mb-4 text-subtle">
            {post.kind === "text" ? (
              <FileText className="size-6" />
            ) : (
              <Link2 className="size-6" />
            )}
          </div>
          <h2 className="max-w-prose text-2xl font-semibold leading-snug tracking-tight text-fg">
            {post.title}
          </h2>
          {post.text ? (
            <p className="mt-4 max-h-64 overflow-y-auto text-base leading-normal text-muted hide-scrollbar">
              {post.text}
            </p>
          ) : null}
        </div>
      )}

      <div
        className={cn(
          "pointer-events-none absolute inset-0",
          landscapeVideo
            ? "bg-linear-to-t from-bg/85 from-20% via-transparent to-transparent"
            : "bg-linear-to-t from-bg/80 via-transparent to-bg/35",
        )}
      />

      {post.kind === "video" && active ? (
        <SpeedBar rate={playbackRate} onChange={setPlaybackRate} />
      ) : null}

      {post.kind === "gallery" && gallery.length > 1 ? (
        <div className="absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 justify-between px-2">
          <button
            type="button"
            className="pointer-events-auto flex size-11 items-center justify-center rounded-full bg-bg/40 text-fg"
            onClick={() =>
              setGalleryIndex((i) => (i - 1 + gallery.length) % gallery.length)
            }
            aria-label="Previous image"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            className="pointer-events-auto flex size-11 items-center justify-center rounded-full bg-bg/40 text-fg"
            onClick={() => setGalleryIndex((i) => (i + 1) % gallery.length)}
            aria-label="Next image"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>
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
            {post.nsfw ? (
              <span className="rounded-full bg-danger/20 px-2.5 py-1 text-danger">NSFW</span>
            ) : null}
            <span className="tabular-nums text-muted">{formatScore(post.score)}</span>
          </div>
          <h2 className="text-base font-semibold leading-snug text-balance text-fg">
            {post.title}
          </h2>
          <p className="mt-1 text-sm text-muted">u/{post.author}</p>
        </div>
      </div>
    </article>
  );
}
