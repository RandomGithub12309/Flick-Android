import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { ActionRail } from "@/components/action-rail";
import { CommentsSheet } from "@/components/comments-sheet";
import { PostSlide } from "@/components/post-slide";
import { SubredditSearch } from "@/components/subreddit-search";
import { refreshDeck } from "@/lib/feed/load";
import { saveRedditPost, unsaveRedditPost } from "@/lib/reddit/loader";
import type { FlickPost, SubredditSort } from "@/lib/reddit/types";
import { useFlick } from "@/store/flick";

const THRESHOLD = 72;

/**
 * Give up auto-skipping after this many dead posts in a row. A whole feed of
 * broken media should surface as a message, not an infinite blur of slides.
 */
const MAX_CONSECUTIVE_SKIPS = 8;
const SKIP_SETTLE_MS = 380;
const NOTICE_MS = 9000;

function deckLabel(source: string, subreddit: string | null): string {
  if (source === "saved") return "Saved";
  if (source === "subreddit" && subreddit) return `r/${subreddit}`;
  return "Shuffle";
}

export function Feed() {
  const posts = useFlick((s) => s.posts);
  const index = useFlick((s) => s.index);
  const muted = useFlick((s) => s.muted);
  const autoAdvance = useFlick((s) => s.autoAdvance);
  const source = useFlick((s) => s.source);
  const activeSubreddit = useFlick((s) => s.activeSubreddit);
  const session = useFlick((s) => s.session);
  const notice = useFlick((s) => s.notice);
  const setNotice = useFlick((s) => s.setNotice);
  const setAutoAdvance = useFlick((s) => s.setAutoAdvance);
  const next = useFlick((s) => s.next);
  const prev = useFlick((s) => s.prev);
  const reroll = useFlick((s) => s.reroll);
  const removePost = useFlick((s) => s.removePost);
  const insertPostAt = useFlick((s) => s.insertPostAt);
  const toggleMuted = useFlick((s) => s.toggleMuted);
  const signOut = useFlick((s) => s.signOut);
  const setScreen = useFlick((s) => s.setScreen);

  const [controlsVisible, setControlsVisible] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [skipNotice, setSkipNotice] = useState<string | null>(null);
  const [undoUnsave, setUndoUnsave] = useState<{ post: FlickPost; atIndex: number } | null>(null);
  const [savedIds, setSavedIds] = useState<Record<string, boolean>>({});

  const trackRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const pendingDrag = useRef(0);
  const noticeTimer = useRef<number | null>(null);
  const undoTimer = useRef<number | null>(null);
  const snapTimer = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const lastY = useRef(0);
  const locked = useRef(false);
  const skips = useRef(0);
  const skipTimer = useRef<number | null>(null);

  const post = posts[index];

  const applyTrackTransform = useCallback((y: number, animate: boolean) => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)" : "none";
    el.style.transform = `translate3d(0, ${y}px, 0)`;
  }, []);

  const snap = useCallback(
    (dir: -1 | 0 | 1, auto = false, pruneId?: string) => {
      if (!auto) skips.current = 0;
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (snapTimer.current !== null) {
        window.clearTimeout(snapTimer.current);
        snapTimer.current = null;
      }
      setAnimating(true);
      if (dir === 1) {
        applyTrackTransform(-window.innerHeight, true);
        snapTimer.current = window.setTimeout(() => {
          snapTimer.current = null;
          applyTrackTransform(0, false);
          if (pruneId) {
            removePost(pruneId);
          } else {
            next();
          }
          setAnimating(false);
        }, 220);
      } else if (dir === -1) {
        applyTrackTransform(window.innerHeight, true);
        snapTimer.current = window.setTimeout(() => {
          snapTimer.current = null;
          applyTrackTransform(0, false);
          prev();
          setAnimating(false);
        }, 220);
      } else {
        applyTrackTransform(0, true);
        snapTimer.current = window.setTimeout(() => {
          snapTimer.current = null;
          setAnimating(false);
        }, 180);
      }
      if (dir !== 0 && navigator.vibrate) navigator.vibrate(8);
    },
    [applyTrackTransform, next, prev, removePost],
  );

  useEffect(() => {
    return () => {
      if (skipTimer.current !== null) window.clearTimeout(skipTimer.current);
      if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
      if (snapTimer.current !== null) window.clearTimeout(snapTimer.current);
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // A post that errors or never starts playing is skipped and pruned from the deck.
  const skipUnplayable = useCallback(
    (deadId: string) => {
      if (skipTimer.current !== null) return;
      skips.current += 1;
      if (skips.current > MAX_CONSECUTIVE_SKIPS) {
        setSkipNotice("Skipped a run of unplayable posts — swipe to continue.");
        skips.current = 0;
        return;
      }
      skipTimer.current = window.setTimeout(() => {
        skipTimer.current = null;
        setSkipNotice("Skipped — couldn't play that one");
        snap(1, true, deadId);
      }, SKIP_SETTLE_MS);
    },
    [snap],
  );

  useEffect(() => {
    if (!skipNotice) return;
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => {
      noticeTimer.current = null;
      setSkipNotice(null);
    }, 2200);
    return () => {
      if (noticeTimer.current !== null) {
        window.clearTimeout(noticeTimer.current);
        noticeTimer.current = null;
      }
    };
  }, [skipNotice]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (searchOpen || commentsOpen) return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        snap(1);
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        snap(-1);
      }
      if (e.key === " ") {
        e.preventDefault();
        toggleMuted();
      }
      if (e.key === "s") reroll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commentsOpen, reroll, searchOpen, snap, toggleMuted]);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (searchOpen || commentsOpen || locked.current || animating) return;
      if (Math.abs(e.deltaY) < 24) return;
      locked.current = true;
      snap(e.deltaY > 0 ? 1 : -1);
      window.setTimeout(() => {
        locked.current = false;
      }, 420);
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => window.removeEventListener("wheel", onWheel);
  }, [animating, commentsOpen, searchOpen, snap]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (animating || searchOpen || commentsOpen) return;
    startY.current = e.clientY;
    lastY.current = e.clientY;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current == null) return;
    lastY.current = e.clientY;
    pendingDrag.current = e.clientY - startY.current;
    if (rafRef.current === null) {
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        if (startY.current != null) {
          applyTrackTransform(pendingDrag.current, false);
        }
      });
    }
  };
  const onPointerUp = () => {
    if (startY.current == null) return;
    const dy = lastY.current - startY.current;
    startY.current = null;
    if (dy < -THRESHOLD) snap(1);
    else if (dy > THRESHOLD) snap(-1);
    else if (Math.abs(dy) > 4) snap(0);
  };

  const openSubreddit = useCallback((subreddit: string, sort?: SubredditSort) => {
    setSearchOpen(false);
    void refreshDeck({ reddit: "subreddit", subreddit, sort }).catch((err) => {
      useFlick.getState().setError(err instanceof Error ? err.message : "Could not load subreddit.");
      useFlick.getState().setScreen("home");
    });
  }, []);

  const handleShare = useCallback(async () => {
    if (!post) return;
    const url = post.permalink;
    if (navigator.share) {
      try {
        await navigator.share({ title: post.title, url });
        return;
      } catch {
        // User cancelled or share unavailable; fall back to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setSkipNotice("Link copied");
    } catch {
      setSkipNotice("Could not copy link");
    }
  }, [post]);

  if (!post) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-muted">Nothing to play.</p>
      </div>
    );
  }

  const around = [-1, 0, 1]
    .map((offset) => {
      if (posts.length === 0) return null;
      const i = (index + offset + posts.length) % posts.length;
      const item = posts[i];
      if (!item) return null;
      if (offset !== 0 && posts.length < 2) return null;
      return { offset, item };
    })
    .filter((v): v is { offset: number; item: typeof post } => v !== null);

  const isSavedInFeed = Boolean(savedIds[post.id]);

  return (
    <section
      className="relative h-dvh w-full touch-none overflow-hidden bg-bg select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div ref={trackRef} className="relative h-full w-full" style={{ willChange: "transform" }}>
        {around.map(({ offset, item }) => (
          <PostSlide
            key={posts.length >= 3 ? item.id : `${item.id}-${offset}`}
            post={item}
            active={offset === 0 && !animating && !commentsOpen && !searchOpen}
            preload={offset === 1}
            muted={muted}
            autoAdvance={autoAdvance}
            offset={offset}
            animating={animating}
            uiVisible={controlsVisible}
            onEnded={() => {
              if (posts.length > 1) snap(1);
            }}
            onOpenSubreddit={(sub) => openSubreddit(sub)}
            onUnplayable={
              offset === 0 && !animating && (item.kind === "video" || Boolean(item.redgifsId))
                ? () => skipUnplayable(item.id)
                : undefined
            }
          />
        ))}
      </div>

      {controlsVisible ? (
        <>
          <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-4 pt-safe">
            <div className="pointer-events-auto pt-3">
              <p className="text-xs font-medium uppercase tracking-widest text-fg/80">
                {deckLabel(source, activeSubreddit)}
              </p>
              <p className="tabular-nums text-sm text-muted">
                {index + 1} / {posts.length}
              </p>
            </div>
            <div className="pointer-events-auto mt-3 flex items-center gap-1.5">
              {session ? (
                <button
                  type="button"
                  aria-label="Search subreddits"
                  className="flex size-9 items-center justify-center rounded-full bg-bg/45 text-fg shadow-[var(--shadow-border)] backdrop-blur-sm"
                  onClick={() => setSearchOpen(true)}
                >
                  <Search className="size-4" />
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-full bg-bg/45 px-2.5 py-1.5 text-xs font-medium text-fg shadow-[var(--shadow-border)] backdrop-blur-sm"
                onClick={() => setAutoAdvance(!autoAdvance)}
              >
                {autoAdvance ? "Auto" : "Loop"}
              </button>
              <button
                type="button"
                className="rounded-full bg-bg/45 px-2.5 py-1.5 text-xs font-medium text-fg shadow-[var(--shadow-border)] backdrop-blur-sm"
                onClick={() => setControlsVisible(false)}
              >
                Hide
              </button>
              <button
                type="button"
                className="rounded-full bg-bg/45 px-2.5 py-1.5 text-xs font-medium text-fg shadow-[var(--shadow-border)] backdrop-blur-sm"
                onClick={() => setScreen("home")}
              >
                Close
              </button>
            </div>
          </header>

          {notice ? (
            <div className="pointer-events-auto absolute inset-x-0 top-28 z-30 flex justify-center px-6">
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="rounded-full bg-bg/85 px-3 py-1.5 text-center text-xs font-medium text-fg shadow-[var(--shadow-border)] backdrop-blur-sm"
              >
                {notice}
              </button>
            </div>
          ) : null}

          {skipNotice ? (
            <div className="pointer-events-none absolute inset-x-0 top-20 z-30 flex justify-center px-6">
              <p className="rounded-full bg-bg/80 px-3 py-1.5 text-center text-xs font-medium text-fg shadow-[var(--shadow-border)] backdrop-blur-sm">
                {skipNotice}
              </p>
            </div>
          ) : null}

          {undoUnsave ? (
            <div className="pointer-events-auto absolute inset-x-0 top-28 z-30 flex justify-center px-6">
              <div className="flex items-center gap-3 rounded-full bg-bg/90 px-4 py-1.5 text-xs font-medium text-fg shadow-[var(--shadow-border)] backdrop-blur-sm">
                <span>Unsaved</span>
                <button
                  type="button"
                  className="font-semibold text-fg underline underline-offset-2"
                  onClick={() => {
                    const target = undoUnsave;
                    setUndoUnsave(null);
                    if (undoTimer.current !== null) {
                      window.clearTimeout(undoTimer.current);
                      undoTimer.current = null;
                    }
                    insertPostAt(target.post, target.atIndex);
                    if (session) {
                      void saveRedditPost(session, target.post.name).catch(() => {
                        setSkipNotice("Could not re-save on Reddit");
                      });
                    }
                  }}
                >
                  Undo
                </button>
              </div>
            </div>
          ) : null}

          <ActionRail
            muted={muted}
            permalink={post.permalink}
            sourceLabel="Reddit"
            saved={isSavedInFeed}
            onShuffle={reroll}
            onToggleMute={toggleMuted}
            onComments={() => setCommentsOpen(true)}
            onShare={() => void handleShare()}
            onSave={
              source !== "saved" && session
                ? () => {
                    const target = post;
                    const nextSaved = !isSavedInFeed;
                    setSavedIds((prevIds) => ({ ...prevIds, [target.id]: nextSaved }));
                    setSkipNotice(nextSaved ? "Saved to Reddit" : "Removed from Saved");
                    const op = nextSaved
                      ? saveRedditPost(session, target.name)
                      : unsaveRedditPost(session, target.name);
                    void op.catch(() => {
                      setSavedIds((prevIds) => ({ ...prevIds, [target.id]: !nextSaved }));
                      setSkipNotice("Could not update Reddit save");
                    });
                  }
                : undefined
            }
            onUnsave={
              source === "saved" && session
                ? () => {
                    const target = post;
                    const atIndex = index;
                    removePost(target.id);
                    setUndoUnsave({ post: target, atIndex });
                    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
                    undoTimer.current = window.setTimeout(() => {
                      undoTimer.current = null;
                      setUndoUnsave(null);
                    }, 4500);
                    void unsaveRedditPost(session, target.name).catch(() => {
                      setSkipNotice("Could not unsave on Reddit");
                    });
                  }
                : undefined
            }
            onSignOut={source === "saved" ? signOut : undefined}
          />
        </>
      ) : (
        <button
          type="button"
          className="absolute inset-0 z-40 cursor-default bg-transparent"
          aria-label="Show interface"
          title="Tap to show interface"
          onClick={() => setControlsVisible(true)}
        />
      )}

      {commentsOpen ? <CommentsSheet post={post} onClose={() => setCommentsOpen(false)} /> : null}

      {searchOpen ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-bg/92 px-5 pt-safe backdrop-blur-md"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={() => setSearchOpen(false)}
        >
          <div className="mx-auto w-full max-w-md pt-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-fg">Browse subreddits</h2>
              <button
                type="button"
                aria-label="Close search"
                onClick={() => setSearchOpen(false)}
                className="flex size-9 items-center justify-center rounded-full bg-surface text-fg"
              >
                <X className="size-4" />
              </button>
            </div>
            <SubredditSearch
              onSelectSubreddit={(sub, sort) => openSubreddit(sub, sort)}
              placeholder="Search any subreddit…"
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
