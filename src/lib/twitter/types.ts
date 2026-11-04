import type { FlickPost } from "../reddit/types";

/**
 * How Flick reaches X.
 *
 * There is no free, stable, unofficial timeline API any more, so an account is
 * fetched one of two ways and the rest of the app works with either:
 *
 * - `api` — the official X API v2 with a read-only Bearer token. Real history,
 *   HD `mp4` variants, engagement counts.
 * - `embed` — the public feed the embeddable timeline widget renders. No key at
 *   all, but only the ~20 newest posts and only what X decides to put there.
 *
 * `bearerToken` picks between them, and an empty token is a valid
 * configuration rather than an error.
 */
export type TwitterTransport = "api" | "embed";

export type TwitterAccount = {
  /** Handle without the leading `@`, e.g. `nasa`. */
  handle: string;
  /**
   * X API v2 Bearer token. Empty means "use the public embed feed".
   *
   * Held on the device like the Reddit tokens and sent only to Flick's own
   * server functions, which call X with it — it never reaches another host.
   */
  bearerToken: string;
};

export type TwitterFeed = {
  posts: FlickPost[];
  /** Cursor for the next page; only the `api` transport paginates. */
  after: string | null;
  transport: TwitterTransport;
  /** Canonical handle X resolved the lookup to — case is not significant. */
  username: string;
  /**
   * Set when the lane played but not as asked: a token that X refused falls
   * back to the embed feed, and the user needs to hear why the deck is short.
   */
  warning?: string;
};
