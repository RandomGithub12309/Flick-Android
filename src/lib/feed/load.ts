import { useFlick } from "@/store/flick";
import { loadDemoFeed, loadSavedFeed } from "@/lib/reddit/loader";
import type { FlickPost } from "@/lib/reddit/types";
import type { FeedSource } from "@/store/flick";

/**
 * Pulling the deck.
 *
 * One source, so the interesting part is what happens when it half-works: an
 * expired Reddit session should still leave a deck to play, and a saved list
 * with nothing watchable in it should say so instead of spinning. Ordering is
 * deliberately NOT here — the store owns it, so any caller that hands over
 * posts gets the same deck rules.
 */

/** Which Reddit feed to pull: the account's own saves, the public mix, or nothing. */
export type RedditLane = "saved" | "demo" | "off";

export type FeedRequest = {
  reddit: RedditLane;
};

export type FeedResult = {
  posts: FlickPost[];
  source: FeedSource;
  /** Worth saying over a deck that still plays, rather than instead of it. */
  notice: string | null;
};

/**
 * The settings a shuffle needs, derived rather than snapshotted.
 *
 * A function of state so a screen can build its own labels from values it
 * already subscribes to, instead of reading the store mid-render and going
 * stale.
 */
export function requestFor(state: { session: { username: string } | null }): FeedRequest {
  // "Saved" without a session is a request nobody can honour, and answering it
  // with an empty deck would read as a broken shuffle.
  return { reddit: state.session ? "saved" : "demo" };
}

/** What this device is currently set up to pull. */
export function defaultRequest(): FeedRequest {
  return requestFor(useFlick.getState());
}

/**
 * Fetch the lane, without touching the screen.
 *
 * Split from `refreshDeck` so the lane policy — when the mix substitutes for a
 * dead session, what `source` ends up meaning — is testable without a UI.
 * A fetch that fails throws: with one lane there is no partial deck to keep
 * aloft, and every caller already has an error path.
 */
export async function loadDeck(
  request: FeedRequest,
  onProgress?: (count: number) => void,
): Promise<FeedResult> {
  const { session } = useFlick.getState();
  const substituted = request.reddit === "saved" && !session;
  const lane: RedditLane = substituted ? "demo" : request.reddit;

  if (lane === "off") return { posts: [], source: "demo", notice: null };

  if (lane === "saved" && session) {
    const posts = await loadSavedFeed(session, { onCount: (count) => onProgress?.(count) });
    return { posts, source: "saved", notice: null };
  }

  const posts = await loadDemoFeed();
  return {
    posts,
    source: "demo",
    notice: substituted
      ? "Reddit didn’t recognise that session — playing the public mix instead."
      : null,
  };
}

/**
 * `loadDeck` wired to the screen: a loading line that counts up as posts arrive,
 * then the deck, then whatever the lane needs the user to know.
 */
export async function refreshDeck(request?: Partial<FeedRequest>): Promise<boolean> {
  const store = useFlick.getState();
  const merged: FeedRequest = { ...defaultRequest(), ...request };
  store.setNotice(null);

  const label =
    merged.reddit === "saved"
      ? "Pulling your saved posts…"
      : merged.reddit === "demo"
        ? "Pulling the Reddit mix…"
        : "Nothing is switched on";
  store.setLoading(label, 0);

  let result: FeedResult;
  try {
    result = await loadDeck(merged, (count) =>
      useFlick.getState().setLoading(useFlick.getState().loadingLabel, count),
    );
  } catch (err) {
    store.setScreen("home");
    store.setError(err instanceof Error && err.message ? err.message : "Reddit did not answer.");
    return false;
  }

  if (result.posts.length === 0) {
    store.setScreen("home");
    store.setError(
      result.source === "saved"
        ? "None of your saved posts have a video or image in them. Save a clip, or shuffle the public mix."
        : "Nothing playable came back this time — the mix is live data, so try again.",
    );
    return false;
  }
  store.setPosts(result.posts, result.source);
  store.setNotice(result.notice);
  return true;
}
