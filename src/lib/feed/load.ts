import { loadDemoFeed, loadSavedFeed, loadSubredditFeed } from "@/lib/reddit/loader";
import { useFlick } from "@/store/flick";
import type { FlickPost, SubredditSort } from "@/lib/reddit/types";
import type { FeedSource, MediaFilter } from "@/store/flick";

export type RedditLane = "saved" | "demo" | "subreddit";

export type FeedRequest = {
  /** Which Reddit feed to pull: saved, public mix, or a specific subreddit. */
  reddit: RedditLane;
  subreddit?: string;
  sort?: SubredditSort;
};

export type FeedResult = {
  posts: FlickPost[];
  source: FeedSource;
  subreddit?: string | null;
  notice: string | null;
};

export function applyDeckFilters(
  posts: FlickPost[],
  options: { mediaFilter: MediaFilter; showNsfw: boolean },
): FlickPost[] {
  return posts.filter((post) => {
    if (!options.showNsfw && post.nsfw) return false;
    if (options.mediaFilter === "video" && post.kind !== "video" && !post.redgifsId) return false;
    return true;
  });
}

export function requestFor(state: { session: { username: string } | null }): FeedRequest {
  return {
    reddit: state.session ? "saved" : "demo",
  };
}

export function defaultRequest(): FeedRequest {
  const { session } = useFlick.getState();
  return requestFor({ session });
}

export async function loadDeck(
  request: FeedRequest,
  onProgress?: (count: number) => void,
): Promise<FeedResult> {
  const state = useFlick.getState();
  const reddit: RedditLane = request.reddit === "saved" && !state.session ? "demo" : request.reddit;
  const filterOpts = { mediaFilter: state.mediaFilter, showNsfw: state.showNsfw };

  if (reddit === "saved" && state.session) {
    const raw = await loadSavedFeed(state.session, {
      onCount: (count) => onProgress?.(count),
      onMore: (more) => {
        const cur = useFlick.getState();
        if (cur.screen === "feed" && cur.source === "saved") {
          cur.appendPosts(
            applyDeckFilters(more, { mediaFilter: cur.mediaFilter, showNsfw: cur.showNsfw }),
          );
        }
      },
    });
    return { posts: applyDeckFilters(raw, filterOpts), source: "saved", notice: null };
  }

  if (reddit === "subreddit" && request.subreddit) {
    const clean = request.subreddit.replace(/^\/?r\//i, "").trim();
    const raw = await loadSubredditFeed(clean, request.sort ?? state.subredditSort, state.session);
    const posts = applyDeckFilters(raw, filterOpts);
    onProgress?.(posts.length);
    return { posts, source: "subreddit", subreddit: clean, notice: null };
  }

  const raw = await loadDemoFeed(state.customSubreddits, state.session);
  const posts = applyDeckFilters(raw, filterOpts);
  onProgress?.(posts.length);
  return { posts, source: "demo", notice: null };
}

export async function refreshDeck(request?: Partial<FeedRequest>): Promise<boolean> {
  const store = useFlick.getState();
  const merged: FeedRequest = { ...defaultRequest(), ...request };
  store.setNotice(null);

  const label =
    merged.reddit === "saved"
      ? "Pulling your saved posts…"
      : merged.reddit === "subreddit" && merged.subreddit
        ? `Loading r/${merged.subreddit.replace(/^\/?r\//i, "")}…`
        : "Pulling the Reddit mix…";
  store.setLoading(label, 0);

  const result = await loadDeck(merged, (count) =>
    useFlick.getState().setLoading(useFlick.getState().loadingLabel, count),
  );
  if (result.posts.length === 0) {
    store.setScreen("home");
    store.setError(
      "Nothing playable matched your filters — try adjusting NSFW/video filters or subreddits.",
    );
    return false;
  }
  store.setPosts(result.posts, result.source, result.subreddit ?? null);
  store.setNotice(result.notice);
  return true;
}
