import { originsIn } from "@/lib/feed/mix";
import { loadDemoFeed, loadSavedFeed } from "@/lib/reddit/loader";
import { loadTwitterFeed, twitterReady } from "@/lib/twitter/loader";
import { useFlick } from "@/store/flick";
import type { FlickPost } from "@/lib/reddit/types";
import type { TwitterAccount, TwitterFeed } from "@/lib/twitter/types";
import type { FeedSource } from "@/store/flick";

/**
 * Pulling the deck.
 *
 * The lanes are fetched at the same time and either may fail without stopping
 * the other: a dead Bearer token or a rate-limited embed feed should still leave
 * a person's saved posts to play, and an expired Reddit session should still
 * leave the X account. So the lanes run through `allSettled` and a failed one
 * comes back as a notice on the feed rather than an error screen.
 *
 * Nothing playable at all is the one case that keeps the user on the landing
 * screen, because there is nothing to show them.
 */
export type RedditLane = "saved" | "demo" | "off";

export type FeedRequest = {
  /** Which Reddit feed to pull: the account's saves, the public mix, or neither. */
  reddit: RedditLane;
  /** Pull the configured X account, when one is configured. */
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
  /** Handle X answered for, and how it was reached. */
  twitterHandle: string | null;
  transport: TwitterFeed["transport"] | null;
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
  twitter: TwitterAccount | null;
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

type Job = { lane: LaneName; run: () => Promise<FlickPost[]> };

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
  const account = state.twitter;
  // "Saved" without a session is a request nobody can honour, and answering it
  // with an empty deck would read as a broken shuffle: fall back to the mix.
  const reddit: RedditLane = request.reddit === "saved" && !state.session ? "demo" : request.reddit;
  const wantTwitter = request.twitter && twitterReady(account);

  // A holder rather than a local `let`: an assignment made inside a job's
  // closure is invisible to narrowing, and the compiler reads the local as
  // still-null on the other side of the await.
  const twitter: { feed: TwitterFeed | null } = { feed: null };
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
  if (wantTwitter && account) {
    jobs.push({
      lane: "twitter",
      run: async () => {
        twitter.feed = await loadTwitterFeed(account);
        return twitter.feed.posts;
      },
    });
  }

  if (jobs.length === 0) {
    return {
      posts: [],
      source: "demo",
      notice: null,
      failures: [],
      twitterHandle: null,
      transport: null,
    };
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
        lane === "twitter" ? "Could not load that X account." : "Reddit did not answer.",
      ),
    });
  }

  // "Saved + X" that came back with only tweets isn't a saved-post deck any
  // more, and the header would be lying about what it is showing.
  const feed = twitter.feed;
  const origins = originsIn(posts);
  const onlyTwitter = origins.length === 1 && origins[0] === "twitter";
  const source: FeedSource =
    reddit === "saved" && answered.has("reddit") ? "saved" : onlyTwitter ? "twitter" : "demo";

  const notes: string[] = failures.map((failure) =>
    failure.lane === "twitter"
      ? `X lane skipped — ${failure.message}`
      : `Reddit lane skipped — ${failure.message}`,
  );
  // A configured account that answered with nothing playable looks exactly like
  // mixing being broken from the outside, so say which of the two it is.
  if (
    wantTwitter &&
    feed &&
    feed.posts.length === 0 &&
    !failures.some((f) => f.lane === "twitter")
  ) {
    notes.push(`@${account?.handle ?? ""} has no playable posts in its last few dozen.`);
  }
  if (feed?.warning) notes.push(feed.warning);

  return {
    posts,
    source,
    notice: notes.filter(Boolean).join(" ") || null,
    failures,
    twitterHandle: feed ? feed.username : null,
    transport: feed ? feed.transport : null,
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
  const handle = store.twitter?.handle;
  if (merged.twitter && handle) labels.push(`@${handle}`);
  store.setLoading(labels.length > 0 ? `Pulling ${labels.join(" + ")}…` : "Pick a source first", 0);

  const result = await loadDeck(merged, (count) =>
    useFlick.getState().setLoading(useFlick.getState().loadingLabel, count),
  );
  if (result.posts.length === 0) {
    store.setScreen("home");
    store.setError(
      result.failures.map((failure) => failure.message).join(" ") ||
        "Nothing playable came back — that account may post no video, or you have saved none.",
    );
    return false;
  }
  store.setPosts(result.posts, result.source);
  store.setNotice(result.notice);
  return true;
}
