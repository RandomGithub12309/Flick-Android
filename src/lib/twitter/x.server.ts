import { env } from "../env.server";
import {
  isHandle,
  normalizeHandle,
  parseSyndicationTimeline,
  parseUserTweets,
  userIdFromLookup,
} from "./parse";
import type { TwitterFeed, TwitterTransport } from "./types";

/**
 * Pulling one X account's posts, on the server.
 *
 * Two transports, chosen by whether a token exists:
 *
 * 1. **`api`** — X API v2 (`/2/users/by/username` then `/2/users/:id/tweets`).
 *    The only supported way in, and the only one that yields real history plus
 *    the HD `mp4` variants the player needs. Needs a read-only Bearer token,
 *    which X now hands out on paid tiers only, so it is opt-in per deployment:
 *    `X_BEARER_TOKEN` in the environment (shared account) or a token pasted in
 *    the app (personal). A pasted token is sent to the API host and nowhere
 *    else.
 * 2. **`embed`** — the JSON inside the page X renders for embedded timelines
 *    (`syndication.twitter.com/srv/timeline-profile/…`). No key, ~20 newest
 *    posts, undocumented, and X has broken and restored it before. It is the
 *    reason a Bearer token is optional rather than required, not a fallback to
 *    be trusted with uptime.
 *
 * Both are wrapped in a short cache: the embed feed rate-limits aggressively
 * per IP and one shuffle re-fetches the same handle several times in a second.
 */

const FETCH_TIMEOUT_MS = 12_000;
/** A shuffle paginates; those page fetches must not each spend a fresh request. */
const CACHE_TTL_MS = 3 * 60 * 1000;
/** A dead handle shouldn't be retried on every swipe either, but should recover. */
const FAILURE_TTL_MS = 45 * 1000;
const CACHE_LIMIT = 60;
/** 100 per page × 3 = 300 posts, enough to keep a mixed deck interesting. */
const MAX_PAGES = 3;
const PER_PAGE = 100;

const BROWSER_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

export class TwitterUpstreamError extends Error {
  status: number;
  /** A refusal to *this* request (bad token, no access) rather than to Flick. */
  credentialRejected: boolean;

  constructor(message: string, status: number, credentialRejected: boolean) {
    super(message);
    this.name = "TwitterUpstreamError";
    this.status = status;
    this.credentialRejected = credentialRejected;
  }
}

function xBase(): string {
  // Overridable because X moved hosts once already (twitter.com → api.x.com)
  // and because a deployment may want to route through its own proxy.
  return (env("X_API_BASE") ?? "https://api.x.com").replace(/\/+$/, "");
}

/** Whether this deployment carries a token of its own, for the connect screen. */
export function hasServerBearerToken(): boolean {
  return Boolean(env("X_BEARER_TOKEN"));
}

function bearerToken(pasted?: string): string {
  // A deployment-wide token wins over nothing, but a personal one wins over
  // it: two people can share a deploy and watch different accounts.
  return (pasted?.trim() || env("X_BEARER_TOKEN") || "").replace(/^Bearer\s+/i, "");
}

/**
 * Translate an upstream status into something a person can act on.
 *
 * `credentialRejected` is the flag that matters downstream: it marks a refusal
 * aimed at this token (401/403 on the API), which is worth routing around by
 * falling back to the keyless feed — as opposed to a missing account or a dead
 * network, where a second door leads to the same dead end and an honest error
 * is the useful answer.
 */
function humanXError(status: number, detail: string, viaApi: boolean): TwitterUpstreamError {
  const rejected = viaApi && (status === 401 || status === 403 || status === 402);
  if (status === 401) {
    return new TwitterUpstreamError(
      "X rejected that Bearer token — it has to be an app-only token from your developer portal, on an app with read access.",
      status,
      true,
    );
  }
  if (
    status === 402 ||
    (status === 403 && /payment|subscri|access|privilege|client not permitted/i.test(detail))
  ) {
    return new TwitterUpstreamError(
      "X says this token's plan can't read timelines. Reading other people's posts needs a paid API tier.",
      status,
      rejected,
    );
  }
  if (status === 403) {
    return new TwitterUpstreamError(
      viaApi
        ? "X refused this request (403) — that is usually a protected account or a token without read access."
        : `X's public embed feed refused this request (403). It is unofficial and comes and goes; a Bearer token uses the supported API instead.`,
      status,
      rejected,
    );
  }
  if (status === 404) {
    return new TwitterUpstreamError("No X account by that name.", status, false);
  }
  if (status === 429) {
    return new TwitterUpstreamError(
      viaApi
        ? "X rate limit reached for this token — try again in a few minutes."
        : "X's public embed feed is rate-limiting this server. Try again shortly, or add a Bearer token for the real API.",
      status,
      false,
    );
  }
  if (!viaApi) {
    return new TwitterUpstreamError(
      `X's public embed feed didn't answer (HTTP ${status}). A token reads the official API instead.`,
      status,
      false,
    );
  }
  return new TwitterUpstreamError(`X API ${status}: ${detail || "no detail"}`, status, false);
}

async function xGet(url: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": BROWSER_UA,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch((err: unknown) => {
    throw new TwitterUpstreamError(
      `Could not reach X: ${err instanceof Error ? err.message : String(err)}`,
      0,
      false,
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
    throw humanXError(res.status, detail, true);
  }
  try {
    return (JSON.parse(text) ?? {}) as Record<string, unknown>;
  } catch {
    throw new TwitterUpstreamError("X returned something that was not JSON.", 502, false);
  }
}

/** `@handle` → numeric user id, cached: every shuffle would otherwise look it up again. */
const userIds = new Map<string, { id: string; exp: number }>();

async function resolveUserId(handle: string, token: string): Promise<string> {
  const cached = userIds.get(handle);
  if (cached && cached.exp > Date.now()) return cached.id;
  if (/^\d{1,25}$/.test(handle)) return handle;
  const json = await xGet(
    `${xBase()}/2/users/by/username/${encodeURIComponent(handle)}?user.fields=username,name`,
    token,
  );
  const id = userIdFromLookup(json);
  if (!id) throw new TwitterUpstreamError(`No X account by the name @${handle}.`, 404, false);
  if (userIds.size > 200) userIds.clear();
  userIds.set(handle, { id, exp: Date.now() + 24 * 60 * 60 * 1000 });
  return id;
}

const TWEET_FIELDS: [string, string][] = [
  ["max_results", String(PER_PAGE)],
  [
    "tweet.fields",
    "created_at,possibly_sensitive,public_metrics,attachments,referenced_tweets,lang",
  ],
  ["expansions", "attachments.media_keys,referenced_tweets.id,author_id"],
  ["user.fields", "username,name"],
  // `variants` is the field that carries playable mp4 URLs; without it the API
  // returns a video with no file in it, which is a slide that skips.
  ["media.fields", "type,url,preview_image_url,variants,duration_ms,width,height,public_metrics"],
  // Boosts and replies are the same clip twice or a conversation; the deck is
  // the account's own posts. Quoted posts are kept and resolved for media.
  ["exclude", "retweets,replies"],
];

async function fetchViaApi(
  handle: string,
  token: string,
  after: string | null,
): Promise<TwitterFeed> {
  const userId = await resolveUserId(handle, token);
  const posts: TwitterFeed["posts"] = [];
  const seen = new Set<string>();
  let cursor = after;
  let username = handle;
  let pages = 0;
  do {
    const params = new URLSearchParams(TWEET_FIELDS);
    if (cursor) params.set("pagination_token", cursor);
    const json = await xGet(
      `${xBase()}/2/users/${encodeURIComponent(userId)}/tweets?${params}`,
      token,
    );
    const page = parseUserTweets(json, handle);
    username = page.username || username;
    for (const post of page.posts) {
      if (seen.has(post.id)) continue;
      seen.add(post.id);
      posts.push(post);
    }
    cursor = page.after;
    pages += 1;
  } while (cursor && pages < MAX_PAGES);
  return { posts, after: cursor, transport: "api", username };
}

/**
 * The feed the embeddable timeline widget renders for a profile.
 *
 * Only `showReplies` is honoured, and the response is a Next.js page rather
 * than an API document — see `parseSyndicationTimeline` for how much that costs
 * in defensiveness.
 */
async function fetchViaEmbed(handle: string, after: string | null): Promise<TwitterFeed> {
  if (after) return { posts: [], after: null, transport: "embed", username: handle };
  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(handle)}?showReplies=false`;
  const res = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": BROWSER_UA,
      // The endpoint sits behind a CDN that has been seen to 403 a request
      // without a Referer that looks like an embed page.
      Referer: "https://publish.twitter.com/",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch((err: unknown) => {
    throw new TwitterUpstreamError(
      `Could not reach X's public feed: ${err instanceof Error ? err.message : String(err)}`,
      0,
      false,
    );
  });
  if (!res.ok) throw humanXError(res.status, "", false);
  const posts = parseSyndicationTimeline(await res.text());
  if (posts.length === 0) {
    throw new TwitterUpstreamError(
      `X's public feed returned nothing playable for @${handle}. Either the account posts no video, it is protected, or the embed feed is down — a Bearer token reads the real API instead.`,
      res.status,
      false,
    );
  }
  return { posts, after: null, transport: "embed", username: posts[0]?.account ?? handle };
}

type CacheRow = { at: number; feed: TwitterFeed | null; error: string | null };
const feedCache = new Map<string, CacheRow>();

function cacheGet(key: string): CacheRow | null {
  const row = feedCache.get(key);
  if (!row) return null;
  const ttl = row.feed ? CACHE_TTL_MS : FAILURE_TTL_MS;
  if (Date.now() - row.at > ttl) {
    feedCache.delete(key);
    return null;
  }
  return row;
}

function cachePut(key: string, row: CacheRow): void {
  if (feedCache.size >= CACHE_LIMIT) {
    const oldest = feedCache.keys().next().value;
    if (oldest) feedCache.delete(oldest);
  }
  feedCache.set(key, row);
}

/** In-flight dedupe: two lanes starting at once should be one pair of requests. */
const inflight = new Map<string, Promise<TwitterFeed>>();

/**
 * Requests per minute this process will pass on to X, split by transport.
 *
 * `twitterFeed` is a public server function sitting in front of someone else's
 * rate limit — without a budget it is a free proxy for hammering X until the
 * deployment (or the shared `X_BEARER_TOKEN`) is throttled for everyone. The
 * keyless feed gets the smaller budget because it is shared per IP and is the
 * one with no account to absorb the blame. Caches and in-flight dedupe mean a
 * normal shuffle of a few people costs two or three requests, not one per tap.
 */
const REQUESTS_PER_MINUTE: Record<TwitterTransport, number> = { embed: 20, api: 90 };
const windowStartedAt = { at: 0 };
const used = { count: 0 };

function takeRequestBudget(transport: TwitterTransport, now: number): boolean {
  const window = Math.floor(now / 60_000);
  if (Math.floor(windowStartedAt.at / 60_000) !== window) {
    windowStartedAt.at = now;
    used.count = 0;
  }
  if (used.count >= REQUESTS_PER_MINUTE[transport]) return false;
  used.count += 1;
  return true;
}

export async function fetchTwitterFeed(input: {
  handle: string;
  bearerToken?: string;
  after?: string | null;
}): Promise<TwitterFeed> {
  const handle = normalizeHandle(input.handle ?? "");
  if (!isHandle(handle)) {
    throw new TwitterUpstreamError(
      "That is not an X handle. Use the name after @ — 1 to 15 letters, numbers or underscores.",
      400,
      false,
    );
  }
  const token = bearerToken(input.bearerToken);
  const after = input.after ?? null;
  const transport: TwitterTransport = token ? "api" : "embed";
  const key = `${transport}:${handle}:${after ?? ""}`;

  const cached = cacheGet(key);
  if (cached?.feed) return cached.feed;
  if (cached?.error) throw new TwitterUpstreamError(cached.error, 0, false);
  const running = inflight.get(key);
  if (running) return running;
  if (!takeRequestBudget(transport, Date.now())) {
    throw new TwitterUpstreamError(
      `Flick is already pulling X for a lot of people right now — try again in a minute.`,
      429,
      false,
    );
  }

  const request = (async (): Promise<TwitterFeed> => {
    try {
      // A token that X rejects (wrong plan, revoked, expired) downgrades to
      // the keyless feed rather than killing the shuffle: a shorter deck beats
      // an error screen, and the warning says what happened.
      if (!token) return await fetchViaEmbed(handle, after);
      try {
        return await fetchViaApi(handle, token, after);
      } catch (err) {
        if (!(err instanceof TwitterUpstreamError) || !err.credentialRejected) throw err;
        const feed = await fetchViaEmbed(handle, after);
        return { ...feed, warning: `${err.message} Playing the public embed feed instead.` };
      }
    } catch (err) {
      cachePut(key, {
        at: Date.now(),
        feed: null,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, request);

  const feed = await request;
  cachePut(key, { at: Date.now(), feed, error: null });
  return feed;
}

/**
 * Test seam: the cache, the id map and the minute budget are all
 * process-wide, and a suite must not inherit them from the last file.
 */
export function clearTwitterCaches(): void {
  feedCache.clear();
  userIds.clear();
  inflight.clear();
  windowStartedAt.at = 0;
  used.count = 0;
}
