import type { FlickPost } from "../reddit/types";

/**
 * The X lane is a **bookmarks file**, not an account.
 *
 * Bookmarks are private: X exposes them only through `GET /2/users/:id/bookmarks`
 * with an OAuth 2.0 *user-context* token carrying `bookmark.read`, and refuses
 * app-only Bearer tokens outright. There is no public surface for them either —
 * the embed feed this lane used to read is per-handle and public-only, so
 * "Flick looks at your bookmarks" cannot be built on it at any level of
 * desperation.
 *
 * So the person's own export is the source of truth for *which* tweets, and the
 * API (when a token exists) is only ever used to look up tweet ids that the
 * export left as bare references. That keeps the credential requirement
 * exactly where the credential is already granted, and it means the lane has no
 * notion of a configured account any more — `TwitterSource` is a token plus a
 * file.
 */

/** One saved tweet, as far as the export describes it. */
export type BookmarkEntry = {
  /** Tweet id, digits only. Every entry has one: it is the join key. */
  id: string;
  /** Canonical status URL, so the share and open-link work without the API. */
  url?: string;
  /** Handle from the export, used for the slide badge when nothing hydrated it. */
  account?: string;
  /** Tweet text from the export — the title when the API is not in play. */
  title?: string;
  /** Seconds, from whatever timestamp column the export carried. */
  createdAt?: number;
  /** Media URLs the export carried. Present means playable with no network. */
  mediaUrls?: string[];
  /**
   * The whole tweet object, when the export was JSON.
   *
   * Kept because it is strictly better than the columns a CSV flattens: media
   * variants, real dimensions, engagement counts. It goes through the same
   * parser as an API response, so a file with no token still plays HD video.
   */
  raw?: Record<string, unknown>;
};

export type BookmarkImport = {
  /** Name the person's file had on their disk, for the settings screen. */
  fileName: string;
  /** ms epoch of the import, so the panel can say how stale it is. */
  importedAt: number;
  /** How the text was read, reported back rather than re-guessed later. */
  format: "csv" | "json" | "jsonl" | "ids";
  entries: BookmarkEntry[];
  /** Lines/rows the file had that were not a tweet — shown, not hidden. */
  rejected: number;
  /**
   * Set when the file had to be slimmed to fit device storage.
   *
   * Persisted because it is a fact about *this* import, not about the write that
   * created it: a person is entitled to know their deck is shorter than their
   * file, on every reload, not only the minute it happened.
   */
  shrunk?: boolean;
};

export type TwitterSource = {
  /**
   * X API v2 Bearer token, used only to resolve ids the export left bare.
   *
   * Optional: a JSON export with inline media needs nothing here. Stored on the
   * device like the Reddit tokens and sent only to Flick's own server functions.
   */
  bearerToken: string;
  bookmarks: BookmarkImport | null;
};

/** What one hydration round did, for the notice and the settings line. */
export type HydrationStats = {
  /** Ids sent to X. */
  requested: number;
  /** Tweets that came back with something playable. */
  resolved: number;
  /** Ids X had no answer for — deleted, protected, or withheld. */
  missing: number;
};

export type TwitterFeed = {
  posts: FlickPost[];
  stats: HydrationStats;
  /** Set when the lane half-worked, so the deck can say so out loud. */
  warning?: string;
};
