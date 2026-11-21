import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Bookmark, BookmarkCheck, Loader2, Play, Search, X } from "lucide-react";
import { searchResultToFlickPost } from "@/lib/pornhub/parse";
import { searchPornhubVideos } from "@/lib/pornhub/pornhub.native";
import type { PornhubSearchResult, PornhubSort } from "@/lib/pornhub/types";
import { searchRedditSubreddits } from "@/lib/reddit/loader";
import type { FlickPost, SubredditInfo, SubredditSort } from "@/lib/reddit/types";
import { formatScore } from "@/lib/utils";
import { useFlick } from "@/store/flick";

export type SearchEngine = "reddit" | "pornhub";

type Props = {
  onSelectSubreddit: (subreddit: string, sort: SubredditSort) => void;
  onPlayPornhub?: (posts: FlickPost[], startIndex: number) => void;
  initialEngine?: SearchEngine;
  placeholder?: string;
  compact?: boolean;
};

const REDDIT_SORTS: { id: SubredditSort; label: string }[] = [
  { id: "hot", label: "Hot" },
  { id: "top", label: "Top" },
  { id: "new", label: "New" },
];

const PH_SORTS: { id: PornhubSort; label: string }[] = [
  { id: "relevance", label: "Relevant" },
  { id: "mv", label: "Most Viewed" },
  { id: "tr", label: "Top Rated" },
  { id: "mr", label: "Newest" },
];

export function SubredditSearch({
  onSelectSubreddit,
  onPlayPornhub,
  initialEngine = "reddit",
  placeholder,
  compact = false,
}: Props) {
  const session = useFlick((s) => s.session);
  const subredditSort = useFlick((s) => s.subredditSort);
  const setSubredditSort = useFlick((s) => s.setSubredditSort);
  const savedPornhub = useFlick((s) => s.savedPornhub);
  const savePornhubPost = useFlick((s) => s.savePornhubPost);
  const unsavePornhubPost = useFlick((s) => s.unsavePornhubPost);
  const setPosts = useFlick((s) => s.setPosts);

  const [engine, setEngine] = useState<SearchEngine>(initialEngine);
  const [query, setQuery] = useState("");

  // Reddit search state
  const [results, setResults] = useState<SubredditInfo[]>([]);
  const [loading, setLoading] = useState(false);

  // Pornhub search state
  const [phSort, setPhSort] = useState<PornhubSort>("relevance");
  const [phResults, setPhResults] = useState<PornhubSearchResult[]>([]);
  const [phPage, setPhPage] = useState(1);
  const [phLoading, setPhLoading] = useState(false);
  const [phLoadingMore, setPhLoadingMore] = useState(false);
  const [phError, setPhError] = useState<string | null>(null);
  const [phSubmittedQuery, setPhSubmittedQuery] = useState("");

  const cleanRedditQuery = query.trim().replace(/^\/?r\//i, "");
  const cleanPhQuery = query.trim();

  const savedPhKeys = new Set(
    savedPornhub.map((p) => p.pornhubKey || p.id.replace(/^ph_/, "")),
  );

  // Live subreddit autocomplete when in Reddit mode.
  useEffect(() => {
    if (engine !== "reddit") return;
    if (cleanRedditQuery.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void searchRedditSubreddits(cleanRedditQuery, session)
        .then((rows) => {
          if (!cancelled) setResults(rows);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cleanRedditQuery, engine, session]);

  const runPhSearch = useCallback(
    async (q: string, sort: PornhubSort, page = 1, append = false) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      setPhError(null);
      if (append) {
        setPhLoadingMore(true);
      } else {
        setPhLoading(true);
        setPhSubmittedQuery(trimmed);
      }
      try {
        const rows = await searchPornhubVideos(trimmed, { page, sort });
        if (append) {
          setPhResults((prev) => {
            const seen = new Set(prev.map((r) => r.viewkey));
            const next = rows.filter((r) => !seen.has(r.viewkey));
            return [...prev, ...next];
          });
        } else {
          setPhResults(rows);
        }
        setPhPage(page);
        if (!append && rows.length === 0) {
          setPhError("No videos found for that search.");
        }
      } catch (err) {
        setPhError(err instanceof Error ? err.message : "Could not search Pornhub.");
      } finally {
        setPhLoading(false);
        setPhLoadingMore(false);
      }
    },
    [],
  );

  const handlePlayPhItem = (index: number) => {
    const posts = phResults.map(searchResultToFlickPost);
    if (onPlayPornhub) {
      onPlayPornhub(posts, index);
    } else {
      setPosts(posts, "pornhub", null, null, index);
    }
  };

  const toggleSavePh = (item: PornhubSearchResult) => {
    if (savedPhKeys.has(item.viewkey)) {
      unsavePornhubPost(item.viewkey);
    } else {
      savePornhubPost(searchResultToFlickPost(item));
    }
  };

  const effectivePlaceholder =
    placeholder ??
    (engine === "pornhub"
      ? "Search Pornhub videos…"
      : "Search subreddits (e.g. Unexpected)");

  return (
    <div className="flex w-full flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <div
          role="group"
          aria-label="Search source"
          className="inline-flex shrink-0 rounded-xl bg-surface-2 p-0.5 shadow-[var(--shadow-border)]"
        >
          <button
            type="button"
            onClick={() => {
              setEngine("reddit");
              setPhError(null);
            }}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              engine === "reddit" ? "bg-fg text-bg" : "text-muted hover:text-fg"
            }`}
          >
            Reddit
          </button>
          <button
            type="button"
            onClick={() => setEngine("pornhub")}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              engine === "pornhub"
                ? "bg-amber-400 text-black"
                : "text-muted hover:text-fg"
            }`}
          >
            Pornhub
          </button>
        </div>

        <form
          className="relative flex flex-1 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            if (engine === "reddit") {
              if (cleanRedditQuery) onSelectSubreddit(cleanRedditQuery, subredditSort);
            } else if (cleanPhQuery) {
              void runPhSearch(cleanPhQuery, phSort, 1, false);
            }
          }}
        >
          <Search className="pointer-events-none absolute left-3 size-4 text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={effectivePlaceholder}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="h-10 w-full rounded-xl bg-surface pl-9 pr-16 text-sm text-fg placeholder:text-muted/70 shadow-[var(--shadow-border)] outline-none focus:ring-2 focus:ring-fg/30"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                if (engine === "pornhub") {
                  setPhResults([]);
                  setPhSubmittedQuery("");
                  setPhError(null);
                }
              }}
              className="absolute right-9 flex size-6 items-center justify-center rounded-full text-muted hover:text-fg"
            >
              <X className="size-4" />
            </button>
          ) : null}
          <button
            type="submit"
            aria-label="Search"
            className="absolute right-1.5 flex size-7 items-center justify-center rounded-lg bg-fg/12 text-fg hover:bg-fg/20"
          >
            <ArrowRight className="size-3.5" />
          </button>
        </form>
      </div>

      {engine === "reddit" ? (
        <>
          {cleanRedditQuery.length > 0 ? (
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex gap-1.5">
                {REDDIT_SORTS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSubredditSort(s.id)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                      subredditSort === s.id
                        ? "bg-fg text-bg"
                        : "bg-surface text-muted hover:text-fg"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {loading ? <Loader2 className="size-3.5 animate-spin text-muted" /> : null}
            </div>
          ) : null}

          {cleanRedditQuery.length > 0 ? (
            <div
              className={`overflow-y-auto rounded-xl bg-surface shadow-[var(--shadow-border)] divide-y divide-fg/8 ${
                compact ? "max-h-56" : "max-h-64"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectSubreddit(cleanRedditQuery, subredditSort)}
                className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm font-medium text-fg hover:bg-fg/5"
              >
                <span>Browse r/{cleanRedditQuery}</span>
                <ArrowRight className="size-4 text-muted" />
              </button>
              {results.map((sub) => (
                <button
                  key={sub.name}
                  type="button"
                  onClick={() => onSelectSubreddit(sub.name, subredditSort)}
                  className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left hover:bg-fg/5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-fg">r/{sub.name}</span>
                      {sub.nsfw ? (
                        <span className="rounded bg-danger/20 px-1.5 py-0.5 text-[10px] font-semibold text-danger">
                          18+
                        </span>
                      ) : null}
                    </div>
                    {sub.title && sub.title !== sub.name ? (
                      <p className="truncate text-xs text-muted">{sub.title}</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {formatScore(sub.subscribers)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 px-0.5">
            <div className="flex flex-wrap gap-1.5">
              {PH_SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setPhSort(s.id);
                    if (phSubmittedQuery) {
                      void runPhSearch(phSubmittedQuery, s.id, 1, false);
                    }
                  }}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                    phSort === s.id
                      ? "bg-amber-400 text-black"
                      : "bg-surface text-muted hover:text-fg"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {phLoading ? <Loader2 className="size-3.5 shrink-0 animate-spin text-muted" /> : null}
          </div>

          {phError ? (
            <p className="px-1 text-xs text-danger">{phError}</p>
          ) : null}

          {phResults.length > 0 ? (
            <div
              className={`overflow-y-auto rounded-xl bg-surface/80 p-2 shadow-[var(--shadow-border)] space-y-2.5 ${
                compact ? "max-h-[46dvh]" : "max-h-[68dvh]"
              }`}
            >
              {phResults.map((item, idx) => {
                const isSaved = savedPhKeys.has(item.viewkey);
                return (
                  <div
                    key={item.viewkey}
                    className="flex gap-2.5 rounded-xl bg-surface-2/80 p-2 shadow-[var(--shadow-border)]"
                  >
                    <button
                      type="button"
                      onClick={() => handlePlayPhItem(idx)}
                      className="group relative aspect-video w-36 shrink-0 overflow-hidden rounded-lg bg-black"
                    >
                      <img
                        src={item.thumbnail}
                        alt={item.title}
                        loading="lazy"
                        className="size-full object-cover transition duration-200 group-hover:scale-105"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition group-hover:opacity-100">
                        <Play className="size-6 text-white drop-shadow" fill="currentColor" />
                      </span>
                      {item.duration ? (
                        <span className="absolute right-1 bottom-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                          {item.duration}
                        </span>
                      ) : null}
                    </button>

                    <div className="flex min-w-0 flex-1 flex-col justify-between gap-1">
                      <button
                        type="button"
                        onClick={() => handlePlayPhItem(idx)}
                        className="text-left"
                      >
                        <p className="line-clamp-2 text-xs font-semibold leading-snug text-fg">
                          {item.title}
                        </p>
                      </button>

                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 text-[11px] text-muted">
                          <p className="truncate">{item.author}</p>
                          <p className="truncate tabular-nums">
                            {[item.views ? `${item.views} views` : null, item.rating]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>

                        <button
                          type="button"
                          aria-label={isSaved ? "Remove from saved" : "Save video"}
                          onClick={() => toggleSavePh(item)}
                          className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition active:scale-95 ${
                            isSaved
                              ? "bg-amber-400 text-black"
                              : "bg-fg/12 text-fg hover:bg-fg/20"
                          }`}
                        >
                          {isSaved ? (
                            <>
                              <BookmarkCheck className="size-3.5" />
                              Saved
                            </>
                          ) : (
                            <>
                              <Bookmark className="size-3.5" />
                              Save
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                disabled={phLoadingMore}
                onClick={() => void runPhSearch(phSubmittedQuery, phSort, phPage + 1, true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-fg/10 py-2.5 text-xs font-semibold text-fg hover:bg-fg/15 disabled:opacity-50"
              >
                {phLoadingMore ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Loading more…
                  </>
                ) : (
                  "Load more results"
                )}
              </button>
            </div>
          ) : !phLoading && !phError ? (
            <p className="px-1 text-xs text-muted">
              Search Pornhub to browse thumbnails &amp; titles, tap to play, or save videos into your combined Mix feed.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
