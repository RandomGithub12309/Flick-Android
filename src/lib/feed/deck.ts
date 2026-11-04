import type { FlickPost } from "../reddit/types";

/**
 * How the deck is assembled out of whatever a fetch returned.
 *
 * Two things go wrong if a saved list is played as-is, and neither shows up in
 * review — only after someone has swiped for a minute. A saved feed arrives in
 * Reddit's order, so playing it straight plays one week of saves back to back;
 * and the same clip can appear twice (a repost, a crosspost's parent, the same
 * v.redd.it upload mirrored by two subreddits), which costs a slide each time.
 * So the deck is deduped by the file it actually plays, then shuffled.
 *
 * Deterministic given the shuffle, which is what makes both halves testable.
 */

export type DeckOptions = {
  /** Injection for tests; defaults to `Math.random`. */
  random?: () => number;
};

/**
 * The file a post plays, or its id when it has no media.
 *
 * The URL and not the id, because duplicate listings never share an id and do
 * share a file. The query string is dropped: Reddit signs its media URLs
 * per-request, so a fresh signature must not read as a different video.
 */
export function mediaKeyOf(post: FlickPost): string {
  const url = post.video?.url ?? post.image?.url;
  if (!url) return `id:${post.id}`;
  return url.split(/[?#]/)[0] ?? `id:${post.id}`;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = out[j];
    out[j] = out[i] as T;
    out[i] = swap as T;
  }
  return out;
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const id = key(item);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

/**
 * One clip per file, in no host's order.
 *
 * The first listing of a clip wins: it is the one the fetch saw first, which is
 * also the one whose subreddit and score the person is most likely to recognise.
 */
export function orderDeck(posts: FlickPost[], options: DeckOptions = {}): FlickPost[] {
  const unique = dedupeBy(posts, mediaKeyOf);
  return shuffle(unique, options.random ?? Math.random);
}
