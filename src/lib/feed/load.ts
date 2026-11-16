import { loadDemoFeed, loadSavedFeed, loadSubredditFeed } from "@/lib/reddit/loader";
import { loadTwitterBookmarks, loadTwitterUserFeed } from "@/lib/twitter/loader";
import { useFlick } from "@/store/flick";
import type { FlickPost, SubredditSort } from "@/lib/reddit/types";
import type { FeedPlatform, FeedSource, MediaFilter } from "@/store/flick";

export type RedditLane = "saved" | "demo" | "subreddit";

export type FeedRequest = {
  /** Which platform mode to load: mix, reddit only, or twitter only. */
  platform?: FeedPlatform;
  /** Which Reddit feed to pull: saved, public mix, or a specific subreddit. */
  reddit: RedditLane;
  subreddit?: string;
  sort?: SubredditSort;
  /** Load media from a specific X @handle. */
  twitterUser?: string;
};

export type FeedResult = {
  posts: FlickPost[];
  source: FeedSource;
  subreddit?: string | null;
  twitterUser?: string | null;
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

export function requestFor(state: {
  session: { username: string } | null;
  feedPlatform?: FeedPlatform;
}): FeedRequest {
  return {
    platform: state.feedPlatform ?? "mix",
    reddit: state.session ? "saved" : "demo",
  };
}

export function defaultRequest(): FeedRequest {
  const { session, feedPlatform } = useFlick.getState();
  return requestFor({ session, feedPlatform });
}

async function loadRedditLane(
  lane: "saved" | "demo",
  onProgress?: (count: number) => void,
  activeSourceMatch: FeedSource = "saved",
): Promise<{ posts: FlickPost[]; source: "saved" | "demo" }> {
  const state = useFlick.getState();
  if (lane === "saved" && state.session) {
    const raw = await loadSavedFeed(state.session, {
      onCount: (count) => onProgress?.(count),
      onMore: (more) => {
        const cur = useFlick.getState();
        if (cur.screen === "feed" && (cur.source === activeSourceMatch || cur.source === "mix")) {
          cur.appendPosts(
            applyDeckFilters(more, { mediaFilter: cur.mediaFilter, showNsfw: cur.showNsfw }),
          );
        }
      },
    });
    return { posts: raw, source: "saved" };
  }
  const raw = await loadDemoFeed(state.customSubreddits, state.session);
  onProgress?.(raw.length);
  return { posts: raw, source: "demo" };
}

export async function loadDeck(
  request: FeedRequest,
  onProgress?: (count: number) => void,
): Promise<FeedResult> {
  const state = useFlick.getState();
  const filterOpts = { mediaFilter: state.mediaFilter, showNsfw: state.showNsfw };

  if (request.twitterUser) {
    if (!state.twitterSession) {
      throw new Error("Sign in to X in Sources & Filters first.");
    }
    const clean = request.twitterUser.replace(/^@/, "").trim();
    const raw = await loadTwitterUserFeed(state.twitterSession, clean);
    const posts = applyDeckFilters(raw, filterOpts);
    onProgress?.(posts.length);
    return { posts, source: "twitter-user", twitterUser: clean, notice: null };
  }

  if (request.reddit === "subreddit" && request.subreddit) {
    const clean = request.subreddit.replace(/^\/?r\//i, "").trim();
    const raw = await loadSubredditFeed(clean, request.sort ?? state.subredditSort, state.session);
    const posts = applyDeckFilters(raw, filterOpts);
    onProgress?.(posts.length);
    return { posts, source: "subreddit", subreddit: clean, notice: null };
  }

  const platform = request.platform ?? state.feedPlatform;
  const redditLane: "saved" | "demo" =
    request.reddit === "saved" && state.session ? "saved" : "demo";

  if (platform === "twitter") {
    if (!state.twitterSession) {
      throw new Error("Sign in to X in Sources & Filters to play your X bookmarks.");
    }
    const raw = await loadTwitterBookmarks(state.twitterSession, {
      onCount: (count) => onProgress?.(count),
      onMore: (more) => {
        const cur = useFlick.getState();
        if (cur.screen === "feed" && cur.source === "twitter") {
          cur.appendPosts(
            applyDeckFilters(more, { mediaFilter: cur.mediaFilter, showNsfw: cur.showNsfw }),
          );
        }
      },
    });
    return { posts: applyDeckFilters(raw, filterOpts), source: "twitter", notice: null };
  }

  if (platform === "mix" && state.twitterSession) {
    let redditCount = 0;
    let twitterCount = 0;
    const reportTotal = () => onProgress?.(redditCount + twitterCount);

    const [redditRes, twitterRes] = await Promise.allSettled([
      loadRedditLane(
        redditLane,
        (c) => {
          redditCount = c;
          reportTotal();
        },
        "mix",
      ),
      loadTwitterBookmarks(state.twitterSession, {
        onCount: (c) => {
          twitterCount = c;
          reportTotal();
        },
        onMore: (more) => {
          const cur = useFlick.getState();
          if (cur.screen === "feed" && cur.source === "mix") {
            cur.appendPosts(
              applyDeckFilters(more, { mediaFilter: cur.mediaFilter, showNsfw: cur.showNsfw }),
            );
          }
        },
      }),
    ]);

    const redditPosts = redditRes.status === "fulfilled" ? redditRes.value.posts : [];
    const twitterPosts = twitterRes.status === "fulfilled" ? twitterRes.value : [];
    const combined = applyDeckFilters([...redditPosts, ...twitterPosts], filterOpts);

    let notice: string | null = null;
    if (redditRes.status === "rejected" && twitterRes.status === "fulfilled") {
      notice = "Reddit failed to load — showing X bookmarks only.";
    } else if (twitterRes.status === "rejected" && redditRes.status === "fulfilled") {
      const msg = twitterRes.reason instanceof Error ? twitterRes.reason.message : "X failed";
      notice = `X bookmarks skipped (${msg}).`;
    } else if (redditRes.status === "rejected" && twitterRes.status === "rejected") {
      throw twitterRes.reason instanceof Error
        ? twitterRes.reason
        : new Error("Could not load Reddit or X.");
    }

    return { posts: combined, source: "mix", notice };
  }

  const redditResult = await loadRedditLane(redditLane, onProgress, redditLane);
  return {
    posts: applyDeckFilters(redditResult.posts, filterOpts),
    source: redditResult.source,
    notice: null,
  };
}

export async function refreshDeck(request?: Partial<FeedRequest>): Promise<boolean> {
  const store = useFlick.getState();
  const merged: FeedRequest = { ...defaultRequest(), ...request };
  store.setNotice(null);

  const platform = merged.platform ?? store.feedPlatform;
  const label = merged.twitterUser
    ? `Loading @${merged.twitterUser.replace(/^@/, "")}…`
    : merged.reddit === "subreddit" && merged.subreddit
      ? `Loading r/${merged.subreddit.replace(/^\/?r\//i, "")}…`
      : platform === "twitter"
        ? "Pulling your X bookmarks…"
        : platform === "mix" && store.twitterSession
          ? "Mixing Reddit & X bookmarks…"
          : merged.reddit === "saved"
            ? "Pulling your saved posts…"
            : "Pulling the Reddit mix…";

  store.setLoading(label, 0);

  const result = await loadDeck(merged, (count) =>
    useFlick.getState().setLoading(useFlick.getState().loadingLabel, count),
  );
  if (result.posts.length === 0) {
    store.setScreen("home");
    store.setError(
      "Nothing playable matched your filters — try adjusting NSFW/video filters or sources.",
    );
    return false;
  }
  store.setPosts(
    result.posts,
    result.source,
    result.subreddit ?? null,
    result.twitterUser ?? null,
  );
  store.setNotice(result.notice);
  return true;
}
