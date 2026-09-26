import { useCallback, useEffect, useRef, useState } from "react";
import { ActionRail } from "@/components/action-rail";
import { PostSlide } from "@/components/post-slide";
import { useFlick } from "@/store/flick";

const THRESHOLD = 72;

/**
 * Give up auto-skipping after this many dead posts in a row. A whole feed of
 * broken media should surface as a message, not an infinite blur of slides.
 */
const MAX_CONSECUTIVE_SKIPS = 8;
const SKIP_SETTLE_MS = 400;

export function Feed() {
  const posts = useFlick((s) => s.posts);
  const index = useFlick((s) => s.index);
  const muted = useFlick((s) => s.muted);
  const source = useFlick((s) => s.source);
  const next = useFlick((s) => s.next);
  const prev = useFlick((s) => s.prev);
  const reroll = useFlick((s) => s.reroll);
  const toggleMuted = useFlick((s) => s.toggleMuted);
  const signOut = useFlick((s) => s.signOut);
  const setScreen = useFlick((s) => s.setScreen);

  const [drag, setDrag] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [skipNotice, setSkipNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const lastY = useRef(0);
  const locked = useRef(false);
  const skips = useRef(0);
  const skipTimer = useRef<number | null>(null);

  const post = posts[index];

  const snap = useCallback(
    (dir: -1 | 0 | 1, auto = false) => {
      // Only deliberate navigation clears the run. An automatic skip changes
      // the index as well, so resetting the counter on the index made the cap
      // unreachable — every skip erased the evidence of the one before it and
      // a dead feed could blur through itself forever.
      if (!auto) skips.current = 0;
      setAnimating(true);
      if (dir === 1) {
        setDrag(-window.innerHeight);
        window.setTimeout(() => {
          next();
          setAnimating(false);
          setDrag(0);
        }, 240);
      } else if (dir === -1) {
        setDrag(window.innerHeight);
        window.setTimeout(() => {
          prev();
          setAnimating(false);
          setDrag(0);
        }, 240);
      } else {
        setDrag(0);
        window.setTimeout(() => setAnimating(false), 180);
      }
      if (dir !== 0 && navigator.vibrate) navigator.vibrate(8);
    },
    [next, prev],
  );

  useEffect(() => {
    return () => {
      if (skipTimer.current !== null) window.clearTimeout(skipTimer.current);
    };
  }, []);

  // A post that errors or never starts playing is skipped automatically. The
  // timeout keeps a burst of simultaneous failures from stacking several
  // snap() animations on the same index.
  const skipUnplayable = useCallback(() => {
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
      snap(1, true);
    }, SKIP_SETTLE_MS);
  }, [snap]);

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
    const onKey = (e: KeyboardEvent) => {
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
  }, [reroll, snap, toggleMuted]);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (locked.current || animating) return;
      if (Math.abs(e.deltaY) < 24) return;
      locked.current = true;
      snap(e.deltaY > 0 ? 1 : -1);
      window.setTimeout(() => {
        locked.current = false;
      }, 420);
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => window.removeEventListener("wheel", onWheel);
  }, [animating, snap]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (animating) return;
    startY.current = e.clientY;
    lastY.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current == null) return;
    lastY.current = e.clientY;
    setDrag(e.clientY - startY.current);
  };
  const onPointerUp = () => {
    if (startY.current == null) return;
    const dy = lastY.current - startY.current;
    startY.current = null;
    if (dy < -THRESHOLD) snap(1);
    else if (dy > THRESHOLD) snap(-1);
    else snap(0);
  };

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
      return { offset, item, i };
    })
    .filter((v): v is { offset: number; item: typeof post; i: number } => v !== null);

  return (
    <section
      className="relative h-dvh w-full touch-none overflow-hidden bg-bg select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {around.map(({ offset, item, i }) => (
        <PostSlide
          key={`${item.id}-${i === index ? "a" : offset}`}
          post={item}
          active={offset === 0 && !animating}
          muted={muted}
          offset={offset}
          drag={drag}
          animating={animating || startY.current != null}
          onUnplayable={item.kind === "video" ? skipUnplayable : undefined}
        />
      ))}

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-4 pt-safe">
        <div className="pointer-events-auto pt-3">
          <p className="text-xs font-medium uppercase tracking-widest text-fg/80">
            {source === "saved" ? "Saved" : "Shuffle"}
          </p>
          <p className="tabular-nums text-sm text-muted">
            {index + 1} / {posts.length}
          </p>
        </div>
        <button
          type="button"
          className="pointer-events-auto mt-3 rounded-full bg-bg/40 px-3 py-2 text-sm text-fg shadow-[var(--shadow-border)]"
          onClick={() => setScreen("home")}
        >
          Close
        </button>
      </header>

      {skipNotice ? (
        <div className="pointer-events-none absolute inset-x-0 top-20 z-30 flex justify-center px-6">
          <p className="rounded-full bg-bg/80 px-3 py-1.5 text-center text-xs font-medium text-fg shadow-[var(--shadow-border)] backdrop-blur-sm">
            {skipNotice}
          </p>
        </div>
      ) : null}

      <ActionRail
        muted={muted}
        permalink={post.permalink}
        onShuffle={reroll}
        onToggleMute={toggleMuted}
        onSignOut={source === "saved" ? signOut : undefined}
      />
    </section>
  );
}
