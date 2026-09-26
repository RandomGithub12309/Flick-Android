
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
          offset={offset}
          drag={drag}
          animating={animating || startY.current != null}
          onUnplayable={item.kind === "video" ? skipUnplayable : undefined}
        />
      ))}

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
