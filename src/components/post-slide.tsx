import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Link2 } from "lucide-react";
import type { FlickPost, FlickVideo } from "@/lib/reddit/types";
import { SeekBar } from "@/components/seek-bar";
import { VideoPlayer } from "@/components/video-player";
import type { PlaybackInfo, VideoHandle } from "@/components/video-player";
import { requestRedgifsClip } from "@/lib/reddit/clip";
import { audioCandidatesFor } from "@/lib/video-sources";
import { cn, formatScore, isLandscapeRatio, mediaRatio } from "@/lib/utils";

/**
 * How many fresh URLs a slide may ask for before it gives up on playing the
 * clip. Two covers an expired link plus one unlucky retry.
 */
const MAX_CLIP_RETRIES = 2;

function redgifsWatchUrl(id: string): string {
  return `https://www.redgifs.com/watch/${id}`;
}

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
  /**
   * A clip looked up on demand, and whether this slide has run out of ways to
   * play it. Both are per-post: the feed keys slides by post id.
   */
  const [clip, setClip] = useState<FlickVideo | null>(null);
  const [unplayable, setUnplayable] = useState(false);
  const videoRef = useRef<VideoHandle>(null);
  const retries = useRef(0);
  const lookedUp = useRef(false);

  const gallery = post.gallery ?? [];
  const redgifsId = post.redgifsId;
  const video = clip ?? post.video;
  const image =
    post.kind === "gallery" ? (gallery[galleryIndex] ?? post.image) : post.image;
  const poster = post.image?.url ?? post.thumbnail;
  const landscapeVideo = isLandscapeRatio(mediaRatio(video?.width, video?.height));
  const landscapeImage = isLandscapeRatio(mediaRatio(image?.width, image?.height));

  const tryingToPlay = Boolean(video) && !unplayable;

  // A redgifs post can reach the feed with nothing playable attached: the
  // lookup failed while loading, or the post is a bare link Reddit never
  // mirrored. One lookup when the slide comes on screen turns those into
  // videos instead of leaving a title card (or a skip) in their place.
  useEffect(() => {
    if (!active || post.video || !redgifsId || lookedUp.current) return;
    lookedUp.current = true;
    let cancelled = false;
    void requestRedgifsClip(redgifsId).then((resolved) => {
      if (!cancelled && resolved) setClip(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [active, post.video, redgifsId]);

  // Swiping back to a slide is a fresh chance to play it.
  useEffect(() => {
    if (!active) return;
    retries.current = 0;
    setUnplayable(false);
  }, [active]);

  const handleUnplayable = useCallback(() => {
    if (!redgifsId) {
      onUnplayable?.();
      return;
    }
    // Reddit's own copy (where one exists) already failed alongside the clip,
    // so a URL fetched just now is the only thing left to try.
    if (retries.current < MAX_CLIP_RETRIES) {
      retries.current += 1;
      const failedUrl = video?.url;
      const redditCopy = post.video;
      void requestRedgifsClip(redgifsId, { fresh: true }).then((resolved) => {
        if (!resolved || resolved.url === failedUrl) {
          setUnplayable(true);
          return;
        }
        // A fresh URL is not a fresh chance to be the last one: keep the host's
        // own copy, with its audio, as the fallback for the new attempt too.
        setClip({
          ...resolved,
          fallbackUrl: redditCopy?.fallbackUrl ?? redditCopy?.url,
          fallbackAudioUrls: redditCopy?.fallbackAudioUrls ?? audioCandidatesFor(redditCopy),
        });
      });
      return;
    }
    // Out of retries. This is a clip someone deliberately saved, so show the
    // post (poster, title, a way out to redgifs) rather than skipping it.
    setUnplayable(true);
  }, [onUnplayable, post.video, redgifsId, video?.url]);

  return (
    <article
      className={cn("absolute inset-0 overflow-hidden bg-bg", animating && "slide-anim")}
      style={{
        transform: `translate3d(0, calc(${offset * 100}% + ${drag}px), 0)`,
        willChange: "transform",
      }}
    >
      {tryingToPlay && video ? (
        <VideoPlayer
          ref={videoRef}
          video={video}
          active={active}
          muted={muted}
          poster={poster}
          onProgress={setPlayback}
          onUnplayable={handleUnplayable}
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
        {tryingToPlay && active ? (
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
          {unplayable && redgifsId ? (
            <a
              href={redgifsWatchUrl(redgifsId)}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-fg/12 px-3 py-1.5 text-sm font-medium text-fg"
            >
              <ExternalLink className="size-4" />
              Watch on redgifs
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
