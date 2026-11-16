import { useEffect, useState } from "react";
import { ArrowRight, Loader2, Search, X } from "lucide-react";
import { searchRedditSubreddits } from "@/lib/reddit/loader";
import type { SubredditInfo, SubredditSort } from "@/lib/reddit/types";
import { formatScore } from "@/lib/utils";
import { useFlick } from "@/store/flick";

type Props = {
  onSelectSubreddit: (subreddit: string, sort: SubredditSort) => void;
  placeholder?: string;
  compact?: boolean;
};

const SORTS: { id: SubredditSort; label: string }[] = [
  { id: "hot", label: "Hot" },
  { id: "top", label: "Top" },
  { id: "new", label: "New" },
];

export function SubredditSearch({
  onSelectSubreddit,
  placeholder = "Search subreddits (e.g. Unexpected)",
  compact = false,
}: Props) {
  const session = useFlick((s) => s.session);
  const subredditSort = useFlick((s) => s.subredditSort);
  const setSubredditSort = useFlick((s) => s.setSubredditSort);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SubredditInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const cleanQuery = query.trim().replace(/^\/?r\//i, "");

  useEffect(() => {
    if (cleanQuery.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void searchRedditSubreddits(cleanQuery, session)
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
  }, [cleanQuery, session]);

  return (
    <div className="w-full space-y-2">
      <form
        className="relative flex items-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (cleanQuery) onSelectSubreddit(cleanQuery, subredditSort);
        }}
      >
        <Search className="pointer-events-none absolute left-3.5 size-4 text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="h-11 w-full rounded-xl bg-surface pl-10 pr-10 text-sm text-fg placeholder:text-muted/70 shadow-[var(--shadow-border)] outline-none focus:ring-2 focus:ring-fg/30"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="absolute right-2.5 flex size-6 items-center justify-center rounded-full text-muted hover:text-fg"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </form>

      {cleanQuery.length > 0 ? (
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex gap-1.5">
            {SORTS.map((s) => (
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

      {cleanQuery.length > 0 ? (
        <div
          className={`overflow-y-auto rounded-xl bg-surface shadow-[var(--shadow-border)] divide-y divide-fg/8 ${
            compact ? "max-h-56" : "max-h-64"
          }`}
        >
          <button
            type="button"
            onClick={() => onSelectSubreddit(cleanQuery, subredditSort)}
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm font-medium text-fg hover:bg-fg/5"
          >
            <span>Browse r/{cleanQuery}</span>
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
    </div>
  );
}
