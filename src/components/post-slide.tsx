import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FastForward, FileText, Link2, RotateCcw, RotateCw } from "lucide-react";
import type { FlickPost, FlickVideo } from "@/lib/reddit/types";
import { SeekBar } from "@/components/seek-bar";
import { VideoPlayer } from "@/components/video-player";
import type { PlaybackInfo, VideoHandle } from "@/components/video-player";
import { requestRedgifsClip } from "@/lib/reddit/clip";
import { isRedgifsProxyUrl } from "@/lib/reddit/redgifs";
import { audioCandidatesFor } from "@/lib/video-sources";
import { cn, formatScore, isLandscapeRatio, mediaRatio } from "@/lib/utils";

const MAX_CLIP_RETRIES = 2;

type Props = {
  post: FlickPost;
  active: boolean;
  preload?: boolean;
  muted: boolean;
  autoAdvance?: boolean;
  offset: number;
  drag: number;
  animating: boolean;
  uiVisible: boolean;
  onUnplayable?: () => void;
  onEnded?: () => void;
  onOpenSubreddit?: (subreddit: string) => void;
};

export function PostSlide({
  post,
  active,
  preload = false,
  muted,
  autoAdvance = false,
  offset,
  drag,
  animating,
  uiVisible,
  onUnplayable,
  onEnded,
  onOpenSubreddit,
}: Props) {
  const [playback, setPlayback] = useState<PlaybackInfo>({
    ratio: null,
    buffered: null,
    current: 0,
    duration: 0,
  });
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [clip, setClip] = useState<FlickVideo | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [speed2x, setSpeed2x] = useState(false);
  const [seekFeedback, setSeekFeedback] = useState<"back" | "forward" | null>(null);

  const videoRef = useRef<VideoHandle>(null);
  const retries = useRef(0);
  const lookedUp = useRef(false);
  const holdTimer = useRef<number | null>(null);
  const heldLong = useRef(false);
  const lastTap = useRef<{ at: number; x: number } | null>(null);
  const tapTimer = useRef<number | null>(null);
  const feedbackTimer = useRef<number | null>(null);
  const swipeX = useRef<number | null>(null);

  const gallery = post.gallery ?? [];
  const redgifsId = post.redgifsId;
  const video = clip ?? post.video;
  const image = post.kind === "gallery" ? (gallery[galleryIndex] ?? post.image) : post.image;
  const poster = post.image?.url ?? post.thumbnail;
  const landscapeVideo = isLandscapeRatio(mediaRatio(video?.width, video?.height));
  const landscapeImage = isLandscapeRatio(mediaRatio(image?.width, image?.height));

  const tryingToPlay = Boolean(video);

  useEffect(() => {
    if (!active) return;
    retries.current = 0;
  }, [active]);

  useEffect(() => {
    return () => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
      if (tapTimer.current !== null) window.clearTimeout(tapTimer.current);
      if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    };
  }, []);

  // Pre-resolve Redgifs clips for both the active slide and the upcoming next slide.
  useEffect(() => {
    if ((!active && !preload) || post.video || clip || !redgifsId || lookedUp.current) return;
    lookedUp.current = true;
    let cancelled = false;
    void requestRedgifsClip(redgifsId).then((resolved) => {
      if (cancelled) return;
      if (resolved) {
        setClip(resolved);
      } else if (active) {
        onUnplayable?.();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [active, clip, onUnplayable, post.video, preload, redgifsId]);

  // If the slide becomes active after a preload lookup already failed, skip it.
  useEffect(() => {
    if (active && !post.video && !clip && redgifsId && lookedUp.current) {
      void requestRedgifsClip(redgifsId, { fresh: true }).then((resolved) => {
        if (resolved) setClip(resolved);
        else onUnplayable?.();
      });
    }
  }, [active, clip, onUnplayable, post.video, redgifsId]);

  const handleUnplayable = useCallback(() => {
    if (!redgifsId) {
      onUnplayable?.();
      return;
    }
    if (retries.current < MAX_CLIP_RETRIES) {
      retries.current += 1;
      const failedUrl = video?.url;
      const redditCopy = post.video;
      void requestRedgifsClip(redgifsId, { fresh: true }).then((resolved) => {
        if (!resolved) {
          onUnplayable?.();
          return;
        }
        if (resolved.url !== failedUrl) {
          setClip({
            ...resolved,
            fallbackUrl: redditCopy?.fallbackUrl ?? redditCopy?.url,
            fallbackAudioUrls: redditCopy?.fallbackAudioUrls ?? audioCandidatesFor(redditCopy),
          });
          return;
        }
        if (isRedgifsProxyUrl(resolved.url)) {
          setAttempt((n) => n + 1);
          return;
        }
        onUnplayable?.();
      });
      return;
    }
    onUnplayable?.();
  }, [onUnplayable, post.video, redgifsId, video?.url]);

  const triggerSeekFeedback = (dir: "back" | "forward") => {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    setSeekFeedback(dir);
    feedbackTimer.current = window.setTimeout(() => {
      feedbackTimer.current = null;
      setSeekFeedback(null);
    }, 500);
  };

  const onSlidePointerDown = (e: React.PointerEvent) => {
    if (!active) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, [role='slider']")) return;
    swipeX.current = e.clientX;
    if (!tryingToPlay) return;
    heldLong.current = false;
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      heldLong.current = true;
      setSpeed2x(true);
      videoRef.current?.setPlaybackRate(2);
    }, 260);
  };

  const onSlidePointerUp = (e: React.PointerEvent) => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (heldLong.current) {
      setSpeed2x(false);
      videoRef.current?.setPlaybackRate(1);
    }
    if (active && post.kind === "gallery" && gallery.length > 1 && swipeX.current !== null) {
      const dx = e.clientX - swipeX.current;
      swipeX.current = null;
      if (dx < -48) {
        setGalleryIndex((i) => (i + 1) % gallery.length);
        return;
      }
      if (dx > 48) {
        setGalleryIndex((i) => (i - 1 + gallery.length) % gallery.length);
        return;
      }
    }
    swipeX.current = null;
  };

  const onSlideClick = (e: React.MouseEvent) => {
    if (!active || !tryingToPlay) return;
    if (heldLong.current) {
      heldLong.current = false;
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest("button, a, [role='slider']")) return;

    const now = Date.now();
    const prevTap = lastTap.current;
    const width = window.innerWidth || 390;
    const zone = e.clientX < width * 0.32 ? "left" : e.clientX > width * 0.68 ? "right" : "center";

    if (prevTap && now - prevTap.at < 260 && zone !== "center") {
      if (tapTimer.current !== null) {
        window.clearTimeout(tapTimer.current);
        tapTimer.current = null;
      }
      lastTap.current = null;
      if (zone === "left") {
        videoRef.current?.seekBy(-5);
        triggerSeekFeedback("back");
      } else {
        videoRef.current?.seekBy(5);
        triggerSeekFeedback("forward");
      }
      return;
    }

    lastTap.current = { at: now, x: e.clientX };
    if (zone === "center") {
      lastTap.current = null;
      videoRef.current?.togglePlay();
      return;
    }
    if (tapTimer.current !== null) window.clearTimeout(tapTimer.current);
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      lastTap.current = null;
      videoRef.current?.togglePlay();
    }, 230);
  };

  return (
    <article
      className={cn("absolute inset-0 overflow-hidden bg-bg", animating && "slide-anim")}
      style={{
        transform: `translate3d(0, calc(${offset * 100}% + ${drag}px), 0)`,
        willChange: "transform",
      }}
      onPointerDown={onSlidePointerDown}
      onPointerUp={onSlidePointerUp}
      onPointerCancel={onSlidePointerUp}
      onClick={onSlideClick}
    >
      {tryingToPlay && video ? (
        <VideoPlayer
          key={attempt}
          ref={videoRef}
          video={video}
          active={active}
          preload={preload}
          muted={muted}
          autoAdvance={autoAdvance}
          poster={poster}
          uiVisible={uiVisible}
          onProgress={setPlayback}
          onUnplayable={handleUnplayable}
          onEnded={onEnded}
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
            loading={active || preload ? "eager" : "lazy"}
            decoding="async"
            className={cn(
              "absolute inset-0 size-full outline outline-1 -outline-offset-1 outline-fg/10",
              landscapeImage ? "object-contain" : "object-cover",
            )}
            draggable={false}
          />
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col justify-end bg-surface px-5 pb-32 pt-safe">
          {uiVisible ? (
            <>
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
            </>
          ) : null}
        </div>
      )}

      {speed2x ? (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-30 flex justify-center pt-safe">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-bg/75 px-3 py-1 text-xs font-semibold text-fg backdrop-blur-sm">
            <FastForward className="size-3.5" />
            2x Speed
          </span>
        </div>
      ) : null}

      {seekFeedback ? (
        <div
          className={cn(
            "pointer-events-none absolute top-1/2 z-30 -translate-y-1/2",
            seekFeedback === "back" ? "left-8" : "right-8",
          )}
        >
          <span className="flex flex-col items-center gap-1 rounded-full bg-bg/65 px-4 py-3 text-xs font-semibold text-fg backdrop-blur-sm">
            {seekFeedback === "back" ? (
              <>
                <RotateCcw className="size-5" />
                <span>-5s</span>
              </>
            ) : (
              <>
                <RotateCw className="size-5" />
                <span>+5s</span>
              </>
            )}
          </span>
        </div>
      ) : null}

      {uiVisible ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-0",
            landscapeVideo
              ? "bg-linear-to-t from-bg/85 from-20% via-transparent to-transparent"
              : "bg-linear-to-t from-bg/80 via-transparent to-bg/35",
          )}
        />
      ) : null}

      {uiVisible && post.kind === "gallery" && gallery.length > 1 ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-14 z-20 flex justify-center pt-safe">
            <span className="rounded-full bg-bg/60 px-2.5 py-0.5 text-xs font-medium tabular-nums text-fg backdrop-blur-sm">
              {galleryIndex + 1} / {gallery.length}
            </span>
          </div>
          <div className="absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 justify-between px-2 pointer-events-none">
            <button
              type="button"
              className="pointer-events-auto flex size-10 items-center justify-center rounded-full bg-bg/45 text-fg"
              onClick={(e) => {
                e.stopPropagation();
                setGalleryIndex((i) => (i - 1 + gallery.length) % gallery.length);
              }}
              aria-label="Previous image"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              className="pointer-events-auto flex size-10 items-center justify-center rounded-full bg-bg/45 text-fg"
              onClick={(e) => {
                e.stopPropagation();
                setGalleryIndex((i) => (i + 1) % gallery.length);
              }}
              aria-label="Next image"
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
        </>
      ) : null}

      {uiVisible ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 pb-safe">
          <div className={cn("px-4 pr-20", tryingToPlay && active ? "pb-3" : "pb-6")}>
            {post.kind === "gallery" && gallery.length > 1 ? (
              <div className="mb-2.5 flex items-center gap-1.5">
                {gallery.slice(0, 10).map((_, idx) => (
                  <span
                    key={idx}
                    className={cn(
                      "h-1.5 rounded-full transition-all",
                      idx === galleryIndex ? "w-4 bg-fg" : "w-1.5 bg-fg/35",
                    )}
                  />
                ))}
              </div>
            ) : null}
            <div className="pointer-events-auto mb-1.5 flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenSubreddit?.(post.subreddit);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="rounded-full bg-fg/14 px-2.5 py-1 hover:bg-fg/25 active:scale-95 transition"
              >
                r/{post.subreddit}
              </button>
              {post.nsfw ? (
                <span className="rounded-full bg-danger/20 px-2.5 py-1 text-danger">NSFW</span>
              ) : null}
              <span className="tabular-nums text-muted">{formatScore(post.score)}</span>
            </div>
            <h2 className="text-base font-semibold leading-snug text-balance text-fg line-clamp-3">
              {post.title}
            </h2>
            <p className="mt-1 text-xs text-muted">u/{post.author}</p>
          </div>

          {tryingToPlay && active ? (
            <div className="px-3 pb-1.5">
              <SeekBar
                ratio={playback.ratio}
                buffered={playback.buffered}
                current={playback.current}
                duration={playback.duration}
                onSeek={(ratio) => videoRef.current?.seek(ratio)}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
