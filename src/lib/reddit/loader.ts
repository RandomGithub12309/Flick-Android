import {
  callDemoFeed,
  callPostComments,
  callRefreshGrant,
  callSavedPage,
  callSavePost,
  callSearchSubreddits,
  callSubredditFeed,
  callUnsavePost,
} from "./api";
import type { FlickPost, RedditComment, RedditSession, SavedPage, SubredditInfo, SubredditSort } from "./types";
import { useFlick } from "@/store/flick";

/** Reddit access tokens live an hour; a shuffle must not start on a dead one. */
export async function ensureFreshSession(session: RedditSession): Promise<RedditSession> {
  if (session.expiresAt > Date.now() + 15_000) return session;
  if (!session.refreshToken) throw new Error("Reddit session expired. Sign in again.");
  const next = await callRefreshGrant({
    refreshToken: session.refreshToken,
    clientId: session.clientId,
  });
  const updated: RedditSession = {
    username: next.username || session.username,
    accessToken: next.accessToken,
    refreshToken: next.refreshToken ?? session.refreshToken,
    expiresAt: next.expiresAt,
    clientId: session.clientId,
  };
  useFlick.getState().setSession(updated);
  return updated;
}

const INITIAL_PAGES = 2;
const MAX_PAGES = 10;

export async function loadSavedFeed(
  session: RedditSession,
  options: {
    onCount?: (count: number) => void;
    onMore?: (posts: FlickPost[]) => void;
  } = {},
): Promise<FlickPost[]> {
  const current = await ensureFreshSession(session);
  const initial: FlickPost[] = [];
  let after: string | null | undefined = null;
  let page = 0;

  for (; page < INITIAL_PAGES; page++) {
    const result: SavedPage = await callSavedPage({
      accessToken: current.accessToken,
      username: current.username,
      after: after ?? null,
    });
    initial.push(...result.posts);
    options.onCount?.(initial.length);
    after = result.after;
    if (!after || result.posts.length === 0) break;
  }

  // Continue fetching remaining pages in the background so the player opens fast.
  if (after && page < MAX_PAGES && options.onMore) {
    const onMore = options.onMore;
    let cursor: string | null = after;
    void (async () => {
      for (let p = page; p < MAX_PAGES && cursor; p++) {
        try {
          const fresh = await ensureFreshSession(useFlick.getState().session ?? current);
          const nextResult: SavedPage = await callSavedPage({
            accessToken: fresh.accessToken,
            username: fresh.username,
            after: cursor,
          });
          if (nextResult.posts.length === 0) break;
          onMore(nextResult.posts);
          cursor = nextResult.after;
        } catch {
          break;
        }
      }
    })();
  }

  return initial;
}

/** Public mix of video/image subreddits — the lane available without signing in. */
export async function loadDemoFeed(subreddits?: string[], session?: RedditSession | null): Promise<FlickPost[]> {
  let accessToken: string | undefined;
  if (session) {
    try {
      accessToken = (await ensureFreshSession(session)).accessToken;
    } catch {
      accessToken = undefined;
    }
  }
  return callDemoFeed(subreddits, accessToken);
}

export async function loadSubredditFeed(
  subreddit: string,
  sort: SubredditSort = "hot",
  session?: RedditSession | null,
): Promise<FlickPost[]> {
  let accessToken: string | undefined;
  if (session) {
    try {
      accessToken = (await ensureFreshSession(session)).accessToken;
    } catch {
      accessToken = undefined;
    }
  }
  return callSubredditFeed({ subreddit, sort, accessToken });
}

export async function searchRedditSubreddits(
  query: string,
  session?: RedditSession | null,
): Promise<SubredditInfo[]> {
  let accessToken: string | undefined;
  if (session) {
    try {
      accessToken = (await ensureFreshSession(session)).accessToken;
    } catch {
      accessToken = undefined;
    }
  }
  return callSearchSubreddits({ query, accessToken });
}

export async function loadPostComments(
  subreddit: string,
  postId: string,
  session?: RedditSession | null,
): Promise<RedditComment[]> {
  let accessToken: string | undefined;
  if (session) {
    try {
      accessToken = (await ensureFreshSession(session)).accessToken;
    } catch {
      accessToken = undefined;
    }
  }
  return callPostComments({ subreddit, postId, accessToken });
}

export async function unsaveRedditPost(session: RedditSession, fullname: string): Promise<void> {
  const current = await ensureFreshSession(session);
  await callUnsavePost({
    accessToken: current.accessToken,
    fullname,
  });
}

export async function saveRedditPost(session: RedditSession, fullname: string): Promise<void> {
  const current = await ensureFreshSession(session);
  await callSavePost({
    accessToken: current.accessToken,
    fullname,
  });
}
