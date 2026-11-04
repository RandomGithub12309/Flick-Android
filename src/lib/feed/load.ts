import { originsIn } from "@/lib/feed/mix";
import { loadDemoFeed, loadSavedFeed } from "@/lib/reddit/loader";
import { loadTwitterBookmarks, twitterReady } from "@/lib/twitter/loader";
import { useFlick } from "@/store/flick";
import type { FlickPost } from "@/lib/reddit/types";
import type { HydrationStats, TwitterSource } from "@/lib/twitter/types";
import type { FeedSource } from "@/store/flick";

/**
 * Pulling the deck.
 *
 * The lanes are fetched at the same time and either may fail without stopping
 * the other: an X import whose ids cannot be resolved should still leave a
 * person's saved posts to play, and an expired Reddit session should still
 * leave the bookmarks that came with media in the file. So the lanes run through
 * `allSettled` and a failed one comes back as a notice on the feed rather than
 * an error screen.
 *
 * Nothing playable at all is the one case that keeps the user on the landing
 * screen, because there is nothing to show them.
 */
export type RedditLane = "saved" | "demo" | "off";

export type FeedRequest = {
  /** Which Reddit feed to pull: the account's saves, the public mix, or neither. */
  reddit: RedditLane;
  /** Pull the imported X bookmarks, when a file has been imported. */
  twitter: boolean;
};

export type LaneName = "reddit" | "twitter";

export type LaneFailure = {
  lane: LaneName;
  message: string;
};

export type FeedResult = {
  posts: FlickPost[];
  source: FeedSource;
  /** Half-truths about a lane, shown over the feed instead of blocking it. */
  notice: string | null;
  failures: LaneFailure[];
  /** What the lookup half of the X lane did, for the settings screen. */
  hydration: HydrationStats | null;
};

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * The settings a shuffle needs, with the policy that goes with them.
 *
 * A function of state rather than a read of the store, so a screen can derive
 * its own labels from values it already subscribes to instead of snapshotting
 * the store mid-render and going stale.
 */
export function requestFor(state: {
  session: { username: string } | null;
  twitter: TwitterSource | null;
  includeTwitter: boolean;
  includeReddit: boolean;
}): FeedRequest {
  return {
    reddit: !state.includeReddit ? "off" : state.session ? "saved" : "demo",
    twitter: state.includeTwitter && twitterReady(state.twitter),
  };
}

/** What this device is currently set up to pull. */
export function defaultRequest(): FeedRequest {
  const { session, twitter, includeTwitter, includeReddit } = useFlick.getState();
  return requestFor({ session, twitter, includeTwitter, includeReddit });
}

/** How many bookmark entries are queued behind the per-shuffle lookup limit. */
function unresolvedBeyondLimit(source: TwitterSource | null): number {
  const entries = source?.bookmarks?.entries ?? [];
  if (entries.length === 0) return 0;
  return Math.max(0, entries.length - LOOKUP_BUDGET_HINT);
}

type Job = { lane: LaneName; run: () => Promise<FlickPost[]> };

/** Kept in sync with `HYDRATE_LIMIT` in the loader by the note it produces. */
const LOOKUP_BUDGET_HINT = 200;

/**
 * Fetch every lane and return one mixed deck, without touching the screen.
 *
 * Split from `refreshDeck` so the lane policy — which lane survives alone, what
 * `source` ends up meaning — is testable without a UI.
 */
export async function loadDeck(
  request: FeedRequest,
  onProgress?: (count: number) => void,
): Promise<FeedResult> {
  const state = useFlick.getState();
  const source = state.twitter;
  // "Saved" without a session is a request nobody can honour, and answering it
  // with an empty deck would read as a broken shuffle: fall back to the mix.
  const reddit: RedditLane = request.reddit === "saved" && !state.session ? "demo" : request.reddit;
  const wantTwitter = request.twitter && twitterReady(source);

  // A holder rather than a local `let`: an assignment made inside a job's
  // closure is invisible to narrowing, and the compiler reads the local as
  // still-null on the other side of the await.
  const twitter: { feed: Awaited<ReturnType<typeof loadTwitterBookmarks>> | null } = {
    feed: null,
  };
  const jobs: Job[] = [];
  if (reddit === "saved" && state.session) {
    const session = state.session;
    jobs.push({
      lane: "reddit",
      run: () => loadSavedFeed(session, { onCount: (count) => onProgress?.(count) }),
    });
  } else if (reddit === "demo") {
    jobs.push({ lane: "reddit", run: () => loadDemoFeed() });
  }
  if (wantTwitter && source) {
    jobs.push({
      lane: "twitter",
      run: async () => {
        const feed = await loadTwitterBookmarks(source);
        twitter.feed = feed;
        return feed.posts;
      },
    });
  }

  if (jobs.length === 0) {
    return { posts: [], source: "demo", notice: null, failures: [], hydration: null };
  }

  const settled = await Promise.allSettled(jobs.map((job) => job.run()));
  const posts: FlickPost[] = [];
  const failures: LaneFailure[] = [];
  const answered = new Set<LaneName>();
  for (let i = 0; i < settled.length; i++) {
    const { lane } = jobs[i] as Job;
    const result = settled[i] as PromiseSettledResult<FlickPost[]>;
    if (result.status === "fulfilled") {
      posts.push(...result.value);
      answered.add(lane);
      onProgress?.(posts.length);
      continue;
    }
    failures.push({
      lane,
      message: messageOf(
        result.reason,
        lane === "twitter" ? "Could not read that bookmarks import." : "Reddit did not answer.",
      ),
    });
  }

  // "Saved + X" that came back with only tweets isn't a saved-post deck any
  // more, and the header would be lying about what it is showing.
  const feed = twitter.feed;
  const origins = originsIn(posts);
  const onlyTwitter = origins.length === 1 && origins[0] === "twitter";
  const feedSource: FeedSource =
    reddit === "saved" && answered.has("reddit") ? "saved" : onlyTwitter ? "twitter" : "demo";

  const notes: string[] = failures.map((failure) =>
    failure.lane === "twitter"
      ? `X lane skipped — ${failure.message}`
      : `Reddit lane skipped — ${failure.message}`,
  );
  // An import that produced nothing looks exactly like mixing being broken from
  // the outside, so say which of the two it is: a file of text-only tweets, or a
  // file whose media X will no longer serve.
  if (wantTwitter && feed && feed.posts.length === 0 && notes.length === 0) {
    const count = source?.bookmarks?.entries.length ?? 0;
    notes.push(
      `None of the ${count} bookmark${count === 1 ? "" : "s"} in that file has playable media — a text-only export shows up like this.`,
    );
  }
  const beyond = unresolvedBeyondLimit(source);
  if (feed && beyond > 0 && feed.posts.length > 0) {
    notes.push(`${beyond} more bookmarks are on file than one shuffle looks up.`);
  }
  if (feed?.warning) notes.push(feed.warning);
  if (source?.bookmarks?.shrunk) {
    notes.push("That file was trimmed to fit this device's storage.");
  }

  return {
    posts,
    source: feedSource,
    notice: notes.filter(Boolean).join(" ") || null,
    failures,
    hydration: feed?.stats ?? null,
  };
}

/**
 * `loadDeck` wired to the screen: a loading line that counts up as posts arrive,
 * then the deck, then whatever the lanes need the user to know.
 */
export async function refreshDeck(request?: Partial<FeedRequest>): Promise<boolean> {
  const store = useFlick.getState();
  const merged: FeedRequest = { ...defaultRequest(), ...request };
  store.setNotice(null);

  const labels: string[] = [];
  if (merged.reddit === "saved") labels.push("your saved posts");
  else if (merged.reddit === "demo") labels.push("the Reddit mix");
  const bookmarks = store.twitter?.bookmarks;
  if (merged.twitter && bookmarks) {
    labels.push(`${bookmarks.entries.length} X bookmarks`);
  }
  store.setLoading(labels.length > 0 ? `Pulling ${labels.join(" + ")}…` : "Pick a source first", 0);

  const result = await loadDeck(merged, (count) =>
    useFlick.getState().setLoading(useFlick.getState().loadingLabel, count),
  );
  if (result.posts.length === 0) {
    store.setScreen("home");
    store.setError(
      result.failures.map((failure) => failure.message).join(" ") ||
        "Nothing playable came back — that file may hold no video, or you have saved none.",
    );
    return false;
  }
  store.setPosts(result.posts, result.source);
  store.setNotice(result.notice);
  return true;
}
