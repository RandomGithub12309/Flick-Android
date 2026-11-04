import { HYDRATE_LIMIT, postFromEntry } from "./bookmarks";
import { twitterHydrate } from "./functions";
import type { HydrationStats, TwitterFeed, TwitterSource } from "./types";
import type { FlickPost } from "../reddit/types";

/**
 * The X lane, from the person's own bookmarks file.
 *
 * Two halves, and the order matters. Posts the file already describes are built
 * locally first — no network, no token, no rate limit — and only the ids it left
 * as bare references go to the server function for lookup. That split is why an
 * export of full tweet objects plays on a device with no credentials at all, and
 * why a list of pasted ids asks for one: the same lane, different amounts of
 * information in the file.
 *
 * A failed lookup is a warning rather than a failure, for the same reason the
 * deck never goes empty because one host hiccuped: the file's own posts are
 * already resolved. Only "nothing at all came back" is allowed to fail the lane,
 * and `@/lib/feed/load` then decides what that means for the shuffle.
 */

export function twitterReady(source: TwitterSource | null): source is TwitterSource {
  return Boolean(source?.bookmarks && source.bookmarks.entries.length > 0);
}

export async function loadTwitterBookmarks(source: TwitterSource): Promise<TwitterFeed> {
  const entries = source.bookmarks?.entries ?? [];
  const posts: FlickPost[] = [];
  const seen = new Set<string>();
  const needingLookup: string[] = [];

  for (const entry of entries) {
    const post = postFromEntry(entry);
    if (post) {
      if (!seen.has(post.id)) {
        seen.add(post.id);
        posts.push(post);
      }
      continue;
    }
    // Deduped against the file's own posts so a tweet described in two rows of
    // the same export is not also looked up. Synthetic keys (a row that was only
    // ever a media URL) are skipped: there is no tweet behind them to ask about,
    // and the endpoint would reject the id outright.
    if (!entry.synthetic && /^\d{1,25}$/.test(entry.id) && !seen.has(`x_${entry.id}`)) {
      needingLookup.push(entry.id);
    }
  }

  const notes: string[] = [];
  const stats: HydrationStats = { requested: 0, resolved: 0, missing: 0 };
  if (needingLookup.length > 0) {
    const slice = needingLookup.slice(0, HYDRATE_LIMIT);
    try {
      const result = await twitterHydrate({
        data: { ids: slice, bearerToken: source.bearerToken.trim() || undefined },
      });
      for (const post of result.posts) {
        if (seen.has(post.id)) continue;
        seen.add(post.id);
        posts.push(post);
      }
      stats.requested += result.stats.requested;
      stats.resolved += result.stats.resolved;
      stats.missing += result.stats.missing;
      if (result.stats.missing > 0) {
        notes.push(
          `${result.stats.missing} bookmarked tweet${result.stats.missing === 1 ? "" : "s"} could not be played — deleted, protected, or not media.`,
        );
      }
      if (result.warning) notes.push(result.warning);
    } catch (err) {
      const message = err instanceof Error ? err.message : "X did not answer.";
      if (posts.length === 0) throw new Error(message);
      stats.requested += slice.length;
      stats.missing += slice.length;
      notes.push(
        `${message} Playing the ${posts.length} post${posts.length === 1 ? "" : "s"} your file carries.`,
      );
    }
    if (needingLookup.length > slice.length) {
      notes.push(
        `Looking up the newest ${HYDRATE_LIMIT} of ${needingLookup.length} unresolved bookmarks.`,
      );
    }
  }

  return {
    posts,
    stats: { ...stats, resolved: posts.length },
    warning: notes.length > 0 ? notes.join(" ") : undefined,
  };
}
