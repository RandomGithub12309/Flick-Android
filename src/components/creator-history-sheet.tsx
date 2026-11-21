import { useCallback, useEffect, useState } from "react";
import { Bookmark, BookmarkCheck, Loader2, Play, X } from "lucide-react";
import { searchResultToFlickPost } from "@/lib/pornhub/parse";
import { fetchPornhubCreatorVideos } from "@/lib/pornhub/pornhub.native";
import type { PornhubSearchResult } from "@/lib/pornhub/types";
import type { FlickPost } from "@/lib/reddit/types";
import { useFlick } from "@/store/flick";

type Props = {
  author: string;
  authorUrl?: string;
  onClose: () => void;
  onPlay: (posts: FlickPost[], startIndex: number) => void;
};

export function CreatorHistorySheet({ author, authorUrl, onClose, onPlay }: Props) {
  const savedPornhub = useFlick((s) => s.savedPornhub);
  const savePornhubPost = useFlick((s) => s.savePornhubPost);
  const unsavePornhubPost = useFlick((s) => s.unsavePornhubPost);

  const [items, setItems] = useState<PornhubSearchResult[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savedKeys = new Set(
    savedPornhub.map((p) => p.pornhubKey || p.id.replace(/^ph_/, "")),
  );

  const loadPage = useCallback(
    async (nextPage: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const rows = await fetchPornhubCreatorVideos({ author, authorUrl, page: nextPage });
        if (append) {
          setItems((prev) => {
            const seen = new Set(prev.map((r) => r.viewkey));
            return [...prev, ...rows.filter((r) => !seen.has(r.viewkey))];
          });
        } else {
          setItems(rows);
          if (rows.length === 0) setError("No videos found for this creator.");
        }
        setPage(nextPage);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load creator videos.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [author, authorUrl],
  );

  useEffect(() => {
    void loadPage(1, false);
  }, [loadPage]);

  const toggleSave = (item: PornhubSearchResult) => {
    if (savedKeys.has(item.viewkey)) {
      unsavePornhubPost(item.viewkey);
    } else {
      savePornhubPost(searchResultToFlickPost(item));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-bg/92 px-4 pt-safe pb-safe backdrop-blur-md"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={onClose}
    >
      <div
        className="mx-auto flex h-full w-full max-w-md flex-col gap-3 pt-4 pb-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-amber-300">
              Pornhub Creator
            </p>
            <h2 className="truncate text-base font-semibold text-fg">{author}</h2>
          </div>
          <button
            type="button"
            aria-label="Close creator history"
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-fg"
          >
            <X className="size-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-muted">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : error && items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted">
            {error}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto rounded-xl bg-surface/80 p-2 shadow-[var(--shadow-border)] space-y-2.5">
            {items.map((item, idx) => {
              const isSaved = savedKeys.has(item.viewkey);
              return (
                <div
                  key={item.viewkey}
                  className="flex gap-2.5 rounded-xl bg-surface-2/80 p-2 shadow-[var(--shadow-border)]"
                >
                  <button
                    type="button"
                    onClick={() => onPlay(items.map(searchResultToFlickPost), idx)}
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
                      onClick={() => onPlay(items.map(searchResultToFlickPost), idx)}
                      className="text-left"
                    >
                      <p className="line-clamp-2 text-xs font-semibold leading-snug text-fg">
                        {item.title}
                      </p>
                    </button>

                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-[11px] tabular-nums text-muted">
                        {[item.views ? `${item.views} views` : null, item.rating]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <button
                        type="button"
                        aria-label={isSaved ? "Remove from saved" : "Save video"}
                        onClick={() => toggleSave(item)}
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
              disabled={loadingMore}
              onClick={() => void loadPage(page + 1, true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-fg/10 py-2.5 text-xs font-semibold text-fg hover:bg-fg/15 disabled:opacity-50"
            >
              {loadingMore ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading more…
                </>
              ) : (
                "Load more videos"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
