import { loadDemoFeed, loadSavedFeed } from "@/lib/reddit/loader";
import { useFlick } from "@/store/flick";
import type { FlickPost } from "@/lib/reddit/types";
import type { FeedSource } from "@/store/flick";

export type RedditLane = "saved" | "demo";

export type FeedRequest = {
  /** Which Reddit feed to pull: the account's saves or the public mix. */
  reddit: RedditLane;
};

export type FeedResult = {
  posts: FlickPost[];
  source: FeedSource;
  notice: string | null;
};

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

  if (reddit === "saved" && state.session) {
    const posts = await loadSavedFeed(state.session, { onCount: (count) => onProgress?.(count) });
    return { posts, source: "saved", notice: null };
  }

  const posts = await loadDemoFeed();
  onProgress?.(posts.length);
  return { posts, source: "demo", notice: null };
}

export async function refreshDeck(request?: Partial<FeedRequest>): Promise<boolean> {
  const store = useFlick.getState();
  const merged: FeedRequest = { ...defaultRequest(), ...request };
  store.setNotice(null);

  const label = merged.reddit === "saved" ? "Pulling your saved posts…" : "Pulling the Reddit mix…";
  store.setLoading(label, 0);

  const result = await loadDeck(merged, (count) =>
    useFlick.getState().setLoading(useFlick.getState().loadingLabel, count),
  );
  if (result.posts.length === 0) {
    store.setScreen("home");
    store.setError("Nothing playable came back — try saving a video on Reddit or playing the sample mix.");
    return false;
  }
  store.setPosts(result.posts, result.source);
  store.setNotice(result.notice);
  return true;
}
