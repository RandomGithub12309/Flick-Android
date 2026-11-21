import type { FlickPost } from "../reddit/types";

export type MixOptions = {
  /** Injection for tests; defaults to `Math.random`. */
  random?: () => number;
};

/**
 * The file a post plays, or its id when it has no media.
 * The query string is dropped because hosts sign URLs, and a fresh signature
 * must not read as a different video.
 */
export function mediaKeyOf(post: FlickPost): string {
  if (post.pornhubKey) return `ph:${post.pornhubKey}`;
  let url = post.video?.url ?? post.image?.url;
  if (!url) return `id:${post.id}`;
  if (url.includes("/api/twitter/video?") || url.includes("/api/pornhub/video?")) {
    try {
      const inner = new URLSearchParams(url.slice(url.indexOf("?") + 1)).get("url");
      if (inner) url = inner;
    } catch {
      return `id:${post.id}`;
    }
  }
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

/** Shuffle and deduplicate a Reddit deck. */
export function orderDeck(posts: FlickPost[], options: MixOptions = {}): FlickPost[] {
  const random = options.random ?? Math.random;
  return shuffle(dedupeBy(posts, mediaKeyOf), random);
}
