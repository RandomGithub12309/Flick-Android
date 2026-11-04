import { redditDemoFeed, redditRefresh, redditSavedPage } from "./functions";
import type { FlickPost, RedditSession, SavedPage } from "./types";
import { useFlick } from "@/store/flick";

/**
 * Reddit lanes, as plain functions.
 *
 * Deliberately free of store writes: the deck loader (`@/lib/feed/load`) owns
 * the loading screen and the mixing, because it has to share both with the X
 * lane. Progress therefore comes back through `onCount` instead of being pushed
 * at a screen.
 */

/** Reddit access tokens live an hour; a shuffle must not start on a dead one. */
export async function ensureFreshSession(session: RedditSession): Promise<RedditSession> {
  if (session.expiresAt > Date.now() + 15_000) return session;
  if (!session.refreshToken) throw new Error("Reddit session expired. Sign in again.");
  const next = await redditRefresh({
    data: {
      refreshToken: session.refreshToken,
      clientId: session.clientId,
    },
  });
  const updated: RedditSession = {
    username: next.username || session.username,
    accessToken: next.accessToken,
    refreshToken: next.refreshToken ?? session.refreshToken,
    expiresAt: next.expiresAt,
    clientId: session.clientId,
  };
  // Written back so a later shuffle doesn't refresh against the same expiry.
  useFlick.getState().setSession(updated);
  return updated;
}

/** Page cap keeps a 40k-post saved list from turning a shuffle into a wait. */
const MAX_PAGES = 10;

export async function loadSavedFeed(
  session: RedditSession,
  options: { onCount?: (count: number) => void } = {},
): Promise<FlickPost[]> {
  const current = await ensureFreshSession(session);
  const all: FlickPost[] = [];
  let after: string | null | undefined = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result: SavedPage = await redditSavedPage({
      data: {
        accessToken: current.accessToken,
        username: current.username,
        after: after ?? null,
      },
    });
    all.push(...result.posts);
    options.onCount?.(all.length);
    after = result.after;
    if (!after || result.posts.length === 0) break;
  }
  return all;
}

/** Public mix of video subreddits — the lane available without signing in. */
export async function loadDemoFeed(): Promise<FlickPost[]> {
  return redditDemoFeed();
}
