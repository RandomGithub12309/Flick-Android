import {
  redditRefresh,
  redditSavedPage,
} from "@/lib/reddit/functions";
import type { FlickPost, RedditSession, SavedPage } from "@/lib/reddit/types";
import { useFlick } from "@/store/flick";

export async function ensureFreshSession(
  session: RedditSession,
): Promise<RedditSession> {
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
  useFlick.getState().setSession(updated);
  return updated;
}

export async function loadAllSaved(session: RedditSession): Promise<FlickPost[]> {
  const store = useFlick.getState();
  store.setLoading("Pulling your saved posts…", 0);
  const current = await ensureFreshSession(session);
  const all: FlickPost[] = [];
  let after: string | null | undefined = null;
  for (let page = 0; page < 10; page++) {
    const result: SavedPage = await redditSavedPage({
      data: {
        accessToken: current.accessToken,
        username: current.username,
        after: after ?? null,
      },
    });
    all.push(...result.posts);
    store.setLoading(`Loaded ${all.length} saved posts…`, all.length);
    after = result.after;
    if (!after || result.posts.length === 0) break;
  }
  return all;
}
