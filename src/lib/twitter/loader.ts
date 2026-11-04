import { twitterFeed } from "./functions";
import { isHandle, normalizeHandle } from "./parse";
import type { TwitterAccount, TwitterFeed } from "./types";

/**
 * Client-side X fetch.
 *
 * One call, not a pagination loop: the server already walks a few pages per
 * request, and the embed transport can't paginate at all. And a lane that
 * throws must not take the shuffle down with it, so the caller — not this
 * function — decides what a failed lane means (see `@/lib/feed/load`).
 */
export function twitterReady(account: TwitterAccount | null): account is TwitterAccount {
  return Boolean(account && isHandle(normalizeHandle(account.handle)));
}

export async function loadTwitterFeed(account: TwitterAccount): Promise<TwitterFeed> {
  const handle = normalizeHandle(account.handle);
  if (!isHandle(handle)) {
    throw new Error("That is not an X handle — 1 to 15 letters, numbers or underscores.");
  }
  return twitterFeed({
    data: { handle, bearerToken: account.bearerToken.trim() || undefined },
  });
}
