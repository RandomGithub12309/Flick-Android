import { env } from "../env.server";
import { parseTweetList, tweetIdsIn } from "./parse";
import type { FlickPost } from "../reddit/types";
import type { HydrationStats } from "./types";

/**
 * Turning bookmark ids into playable posts, on the server.
 *
 * This is the *only* X call Flick makes now. Bookmarks themselves are not read
 * here — they are private, and X only serves them to an OAuth 2.0 user-context
 * token with `bookmark.read`, which a personal Bearer token is not. What the
 * import leaves behind is a list of ids, and ids of *public* tweets can be
 * resolved with the ordinary tweet-lookup endpoint. That distinction is the
 * whole design: the private half stays a file on the person's device, and the
 * public half is a normal API read.
 *
 * Notes on how it is called:
 *
 * - **Cache is per tweet id, not per request.** A shuffle re-pulls the same deck
 *   every tap, and a per-response cache would key on the exact id set — which
 *   changes the moment one tweet is added or dropped, invalidating all of it.
 *   Per-id caching means an import that has been resolved once costs zero
 *   requests until it expires.
 * - **Ids X had no answer for are cached as "no answer"** for a short window.
 *   Deleted and protected tweets never come back, and re-asking for them each
 *   shuffle is how a rate limit gets spent on 404s.
 * - **100 ids per request** is the endpoint's own cap; the caller's limit keeps
 *   one shuffle to a handful of requests.
 */

const FETCH_TIMEOUT_MS = 12_000;
/** A bookmarked tweet's media does not change; a shuffle should not re-read it. */
const CACHE_TTL_MS = 30 * 60 * 1000;
/** Long enough to stop a retry storm, short enough that a blip recovers. */
const FAILURE_TTL_MS = 60 * 1000;
const CACHE_LIMIT = 4000;
export const IDS_PER_REQUEST = 100;
/** Three requests' worth of ids per call keeps one shuffle's tail bounded. */
export const MAX_IDS_PER_CALL = 300;
/**
 * Requests per minute this process will pass on to X.
 *
 * `twitterHydrate` is a public server function in front of someone else's rate
 * limit; without a budget it is a free proxy for hammering X until the
 * deployment — or the shared `X_BEARER_TOKEN` — is throttled for everyone.
 */
const REQUESTS_PER_MINUTE = 30;

export class TwitterUpstreamError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TwitterUpstreamError";
    this.status = status;
  }
}

function xBase(): string {
  // Overridable because X moved hosts once already (twitter.com → api.x.com)
  // and because a deployment may want to route through its own proxy.
  return (env("X_API_BASE") ?? "https://api.x.com").replace(/\/+$/, "");
}

/** Whether this deployment carries a token of its own, for the settings screen. */
export function hasServerBearerToken(): boolean {
  return Boolean(env("X_BEARER_TOKEN"));
}

export function resolveToken(pasted?: string): string {
  // A deployment-wide token lets a device import a file with no media columns
  // and still resolve it; a pasted one wins, so a personal token is never
  // silently used in someone else's quota.
  return (pasted?.trim() || env("X_BEARER_TOKEN") || "").replace(/^Bearer\s+/i, "");
}

/**
 * Translate an upstream status into something a person can act on.
 *
 * The wording is specific to this call on purpose: "X rejected the token" reads
 * very differently when the token is being used to look up ids you already have
 * than when it is being used to read a timeline. A plan that cannot read posts
 * at all is the common case, and it is not fixed by re-pasting the token.
 */
function humanXError(status: number, detail: string): TwitterUpstreamError {
  if (status === 401) {
    return new TwitterUpstreamError(
      "X rejected that Bearer token — it has to be the app-only token from your developer portal.",
      status,
    );
  }
  if (
    status === 402 ||
    (status === 403 && /payment|subscri|access|privilege|client not permitted/i.test(detail))
  ) {
    return new TwitterUpstreamError(
      "X says this token's plan cannot read posts. Tweet lookup is a paid endpoint — the tweets your file already carries still play.",
      status,
    );
  }
  if (status === 403) {
    return new TwitterUpstreamError(
      "X refused this lookup (403) — usually a token without read access.",
      status,
    );
  }
  if (status === 429) {
    return new TwitterUpstreamError(
      "X rate limit reached for this token — try again in a few minutes.",
      status,
    );
  }
  if (status === 400) {
    return new TwitterUpstreamError(
      `X could not read those ids: ${detail || "malformed request"}`,
      status,
    );
  }
  return new TwitterUpstreamError(`X API ${status}: ${detail || "no detail"}`, status);
}

async function xGet(url: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch((err: unknown) => {
    throw new TwitterUpstreamError(
      `Could not reach X: ${err instanceof Error ? err.message : String(err)}`,
      0,
    );
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 240);
    try {
      const parsed = JSON.parse(text) as {
        detail?: string;
        title?: string;
        errors?: { message?: string }[];
      };
      detail = parsed.detail || parsed.title || parsed.errors?.[0]?.message || detail;
    } catch {
      // X sometimes answers an unexpected request with HTML.
    }
    throw humanXError(res.status, detail);
  }
  try {
    return (JSON.parse(text) ?? {}) as Record<string, unknown>;
  } catch {
    throw new TwitterUpstreamError("X returned something that was not JSON.", 502);
  }
}

type Cached = { at: number; post: FlickPost | null };
const byId = new Map<string, Cached>();

function cacheTake(
  id: string,
  now: number,
): { hit: true; post: FlickPost | null } | { hit: false } {
  const row = byId.get(id);
  if (!row) return { hit: false };
  const ttl = row.post ? CACHE_TTL_MS : FAILURE_TTL_MS;
  if (now - row.at > ttl) {
    byId.delete(id);
    return { hit: false };
  }
  return { hit: true, post: row.post };
}

function cachePut(id: string, post: FlickPost | null, now: number): void {
  if (byId.size >= CACHE_LIMIT) {
    // Oldest-first eviction; insertion order makes that the least recently
    // fetched, which is close enough and costs nothing.
    const oldest = byId.keys().next().value;
    if (oldest) byId.delete(oldest);
  }
  byId.set(id, { at: now, post });
}

type LookupResult = { posts: FlickPost[]; answered: string[]; stopped: boolean };
const inflight = new Map<string, Promise<LookupResult>>();

const budget = { window: 0, count: 0 };

function takeRequest(now: number): boolean {
  const window = Math.floor(now / 60_000);
  if (budget.window !== window) {
    budget.window = window;
    budget.count = 0;
  }
  if (budget.count >= REQUESTS_PER_MINUTE) return false;
  budget.count += 1;
  return true;
}

const LOOKUP_FIELDS = new URLSearchParams({
  // `variants` is the field that carries playable mp4 URLs; without it the API
  // returns a video with no file in it, which is a slide that skips.
  "media.fields": "type,url,preview_image_url,variants,duration_ms,width,height,public_metrics",
  expansions: "attachments.media_keys,author_id,referenced_tweets.id",
  "user.fields": "username,name",
  "tweet.fields": "created_at,possibly_sensitive,public_metrics,attachments,referenced_tweets,lang",
});

/**
 * One lookup, in chunks of the endpoint's own cap.
 *
 * `stopped` is the budget running out mid-request. It is a flag rather than a
 * throw because the chunks already fetched are real posts: failing the whole
 * call to enforce a rate limit would throw away the work that succeeded, which
 * is the opposite of what a budget is for.
 */
async function lookup(
  ids: string[],
  token: string,
  now: number,
): Promise<{ posts: FlickPost[]; answered: string[]; stopped: boolean }> {
  const posts: FlickPost[] = [];
  const answered: string[] = [];
  let stopped = false;
  for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
    if (!takeRequest(now)) {
      stopped = true;
      break;
    }
    const chunk = ids.slice(i, i + IDS_PER_REQUEST);
    const params = new URLSearchParams(LOOKUP_FIELDS);
    params.set("ids", chunk.join(","));
    const json = await xGet(`${xBase()}/2/tweets?${params}`, token);
    const page = parseTweetList(json);
    posts.push(...page);
    answered.push(...tweetIdsIn(json));
  }
  return { posts, answered, stopped };
}

export type HydrationResult = {
  posts: FlickPost[];
  stats: HydrationStats;
  /** Set when the lookup half-failed and the cached posts carried on. */
  warning?: string;
};

/**
 * Resolve bookmark ids into posts.
 *
 * Returns what it managed to resolve rather than throwing on a partial failure:
 * a library where 40 of 200 ids are deleted tweets is not an error, and the
 * caller decides what `missing` means for the notice it shows.
 */
export async function hydrateTweetIds(
  input: { ids: string[]; bearerToken?: string },
  now = Date.now(),
): Promise<HydrationResult> {
  // Only digits, only once, only as many as one call may spend. Anything else
  // in the file is the import's problem, not something to forward to X.
  const ids = [
    ...new Set(input.ids.map((id) => id.trim()).filter((id) => /^\d{1,25}$/.test(id))),
  ].slice(0, MAX_IDS_PER_CALL);
  if (ids.length === 0) {
    return { posts: [], stats: { requested: 0, resolved: 0, missing: 0 } };
  }

  const cached = new Map<string, FlickPost | null>();
  const missingFromCache: string[] = [];
  for (const id of ids) {
    const hit = cacheTake(id, now);
    if (hit.hit) cached.set(id, hit.post);
    else missingFromCache.push(id);
  }
  const fromCache = [...cached.values()].filter((post): post is FlickPost => post !== null);

  if (missingFromCache.length === 0) {
    return {
      posts: fromCache,
      stats: { requested: 0, resolved: fromCache.length, missing: 0 },
    };
  }

  const token = resolveToken(input.bearerToken);
  if (!token) {
    throw new TwitterUpstreamError(
      `Flick cannot look up ${missingFromCache.length} of those tweets without a Bearer token. Paste one under Sources, or use an export that includes media URLs — that half needs no API at all.`,
      0,
    );
  }

  const key = `${token.slice(-8)}:${missingFromCache.join(",")}`;

  const startRequest = async (): Promise<Awaited<ReturnType<typeof lookup>>> => {
    const request = lookup(missingFromCache, token, now).finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, request);
    return request;
  };

  try {
    // A shuffle two people started at the same instant is one pair of requests.
    const result = await (inflight.get(key) ?? startRequest());

    const postsById = new Map<string, FlickPost>();
    for (const post of result.posts) {
      const id = post.id.replace(/^x_/, "");
      postsById.set(id, post);
    }
    const answered = new Set(result.answered);
    const stamp = Date.now();
    for (const id of missingFromCache) {
      // An id X answered with nothing playable (a text-only tweet, a poll) is
      // cached as a negative so the next shuffle does not ask again; an id X
      // never mentioned at all is left uncached, since that one may be a
      // transient upstream miss rather than an answer.
      if (postsById.has(id) || answered.has(id)) cachePut(id, postsById.get(id) ?? null, stamp);
    }
    const posts = [...fromCache, ...result.posts];
    const seen = new Set<string>();
    const unique = posts.filter((post) => {
      if (seen.has(post.id)) return false;
      seen.add(post.id);
      return true;
    });
    const stats: HydrationStats = {
      requested: missingFromCache.length,
      resolved: unique.length,
      missing: Math.max(0, missingFromCache.length - result.answered.length),
    };
    if (!result.stopped) return { posts: unique, stats };
    // Not an error, and not silent either: the rest of the file will resolve on
    // the next shuffle, and a person staring at a short deck needs to know that
    // is what they are looking at.
    return {
      posts: unique,
      stats,
      warning:
        "Flick is already looking up X bookmarks for a lot of people right now, so this shuffle stopped early — the rest resolve on the next one.",
    };
  } catch (err) {
    if (fromCache.length === 0) throw err;
    // The file's own posts are still real. Losing the lookup is a warning over
    // a deck, not a reason to throw the deck away.
    return {
      posts: fromCache,
      stats: {
        requested: missingFromCache.length,
        resolved: fromCache.length,
        missing: missingFromCache.length,
      },
      warning: err instanceof Error ? err.message : "The X lookup failed.",
    };
  }
}

/**
 * Test seam: the cache, the in-flight map and the minute budget are process-wide,
 * and a suite must not inherit them from the last file.
 */
export function clearTwitterCaches(): void {
  byId.clear();
  inflight.clear();
  budget.window = 0;
  budget.count = 0;
}
