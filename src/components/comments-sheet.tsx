import { useEffect, useState } from "react";
import { Loader2, MessageCircle, X } from "lucide-react";
import { fetchPornhubComments } from "@/lib/pornhub/pornhub.native";
import { loadPostComments } from "@/lib/reddit/loader";
import { loadTwitterComments } from "@/lib/twitter/loader";
import type { FlickPost, RedditComment } from "@/lib/reddit/types";
import { formatScore } from "@/lib/utils";
import { useFlick } from "@/store/flick";

type Props = {
  post: FlickPost;
  onClose: () => void;
};

export function CommentsSheet({ post, onClose }: Props) {
  const session = useFlick((s) => s.session);
  const twitterSession = useFlick((s) => s.twitterSession);
  const [comments, setComments] = useState<RedditComment[]>([]);
  const [loading, setLoading] = useState(true);
  const isTwitter = post.platform === "twitter";
  const isPornhub = post.platform === "pornhub";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const loader = isPornhub
      ? fetchPornhubComments(post.pornhubKey || post.id.replace(/^ph_/, ""))
      : isTwitter
        ? twitterSession
          ? loadTwitterComments(twitterSession, post.id)
          : Promise.resolve([])
        : loadPostComments(post.subreddit, post.id, session);
    void loader
      .then((rows) => {
        if (!cancelled) setComments(rows);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isPornhub, isTwitter, post.id, post.pornhubKey, post.subreddit, session, twitterSession]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-[2px]"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={onClose}
    >
      <div
        className="flex max-h-[72dvh] w-full flex-col rounded-t-3xl bg-surface pb-safe shadow-[var(--shadow-border)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-fg/10 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <MessageCircle className="size-4 text-muted" />
            <h2 className="text-sm font-semibold text-fg">Comments</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comments"
            className="flex size-8 items-center justify-center rounded-full bg-fg/10 text-fg"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : comments.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">No comments yet.</p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="space-y-1 border-b border-fg/8 pb-3 last:border-none">
                <div className="flex items-center justify-between text-xs text-muted">
                  <span className="font-medium text-fg/90">
                    {isPornhub ? c.author : isTwitter ? `@${c.author}` : `u/${c.author}`}
                  </span>
                  <span className="tabular-nums">{formatScore(c.score)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg/85 break-words">
                  {c.body}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
