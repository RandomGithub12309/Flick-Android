import { callDemoFeed, callRefreshGrant, callSavedPage } from "./api";
import type { FlickPost, RedditSession, SavedPage } from "./types";
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
    const result: SavedPage = await callSavedPage({
      accessToken: current.accessToken,
      username: current.username,
      after: after ?? null,
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
  return callDemoFeed();
}
