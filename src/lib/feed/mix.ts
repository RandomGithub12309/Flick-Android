import type { FlickOrigin, FlickPost } from "../reddit/types";

/**
 * How a multi-host deck is assembled.
 *
 * "Mix them together" is the feature, and the naive version fails it twice:
 * `concat` leaves a wall of Reddit followed by a wall of tweets, and
 * `concat`-then-shuffle buries a 20-post X timeline in a 400-post saved list at
 * one tweet every twentieth slide. So the mixer treats each lane as a pool,
 * keeps no lane above half the deck, and distributes the smaller lane evenly
 * through the larger one. Deterministic given the shuffle, which is what makes
 * it testable.
 */

/** Neither host may be more than half the deck — at worst they alternate. */
const DEFAULT_MAX_SHARE = 0.5;

export type MixOptions = {
  /**
   * Largest fraction of the deck a single lane may occupy. At the default, the
   * larger lane only gets trimmed down to parity with the smaller one; a higher
   * value keeps every post of both and relies on the spread alone.
   */
  maxShare?: number;
  /** Injection for tests; defaults to `Math.random`. */
  random?: () => number;
};

export function originOf(post: FlickPost): FlickOrigin {
  return post.origin ?? "reddit";
}

export function originsIn(posts: FlickPost[]): FlickOrigin[] {
  const found = new Set<FlickOrigin>();
  for (const post of posts) found.add(originOf(post));
  return [...found];
}

/**
 * The file a post plays, or its id when it has no media.
 *
 * One clip on both hosts is the common case once X is in the deck — people post
 * a clip to X and save it from Reddit — and the ids differ, so the URL is the
 * only thing to compare. The query string is dropped because both hosts sign
 * theirs, and a fresh signature must not read as a different video.
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
 * Weave `extra` through `base` at an even stride, so the deck alternates in a
 * pattern instead of in blocks and the added lane shows up early rather than in
 * a tail nobody swipes to. `base` must be the longer lane, which is what keeps
 * the stride ≥ 1 and stops two tweets landing back to back.
 */
function interleave(base: FlickPost[], extra: FlickPost[]): FlickPost[] {
  if (extra.length === 0) return base;
  if (base.length === 0) return extra;
  const out: FlickPost[] = [];
  const stride = base.length / extra.length;
  let at = 0;
  for (let i = 0; i < extra.length; i++) {
    const target = Math.floor((i + 0.5) * stride);
    while (at <= target && at < base.length) {
      out.push(base[at] as FlickPost);
      at += 1;
    }
    out.push(extra[i] as FlickPost);
  }
  while (at < base.length) {
    out.push(base[at] as FlickPost);
    at += 1;
  }
  return out;
}

export type Lanes = {
  reddit: FlickPost[];
  twitter: FlickPost[];
};

export function splitByOrigin(posts: FlickPost[]): Lanes {
  const lanes: Lanes = { reddit: [], twitter: [] };
  for (const post of posts) lanes[originOf(post)].push(post);
  return lanes;
}

/**
 * Assemble a deck from the two lanes.
 *
 * Each lane arrives in its host's order (newest first, or saved order), which is
 * exactly the order a shuffle player must not play through — so both are
 * shuffled inside their own lane first. The interleaving that follows is what
 * makes it a mix rather than two feeds stapled together.
 */
export function mixFeeds(
  reddit: FlickPost[],
  twitter: FlickPost[],
  options: MixOptions = {},
): FlickPost[] {
  const random = options.random ?? Math.random;
  const maxShare = Math.min(1, Math.max(0.05, options.maxShare ?? DEFAULT_MAX_SHARE));

  // Dedupe across lanes before the cap, so a clip posted to both hosts costs
  // one slide instead of eating a slot of the added lane's budget.
  const primary = dedupeBy(reddit, mediaKeyOf);
  const seen = new Set(primary.map(mediaKeyOf));
  const secondary = dedupeBy(twitter, mediaKeyOf).filter((post) => !seen.has(mediaKeyOf(post)));

  const shuffledPrimary = shuffle(primary, random);
  let kept = shuffle(secondary, random);
  if (kept.length === 0) return shuffledPrimary;
  if (shuffledPrimary.length === 0) return kept;
  if (maxShare < 1) {
    const budget = Math.max(1, Math.round((maxShare / (1 - maxShare)) * shuffledPrimary.length));
    kept = kept.slice(0, Math.min(kept.length, budget));
  }

  // Spread the shorter lane through the longer one, whichever name it has: the
  // rule is "no blocks", not "Reddit leads".
  return kept.length > shuffledPrimary.length
    ? interleave(kept, shuffledPrimary)
    : interleave(shuffledPrimary, kept);
}

/**
 * What the store calls with whatever it was handed: one lane becomes a plain
 * shuffle, two lanes become a mix. So a caller can hand over
 * `[...saved, ...tweets]` without knowing which hosts answered, and a Reddit
 * deck keeps the old behaviour exactly.
 */
export function orderDeck(posts: FlickPost[], options: MixOptions = {}): FlickPost[] {
  const lanes = splitByOrigin(posts);
  if (lanes.twitter.length === 0) return shuffle(lanes.reddit, options.random ?? Math.random);
  if (lanes.reddit.length === 0) return shuffle(lanes.twitter, options.random ?? Math.random);
  return mixFeeds(lanes.reddit, lanes.twitter, options);
}
