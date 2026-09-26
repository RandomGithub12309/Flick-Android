import { parseListingChildren, parseRedditPost, redgifsIdFromPost } from "./parse";
import { audioCandidatesFor } from "../video-sources";
import type { FlickPost, SavedPage } from "./types";

const USER_AGENT = "android:app.flick.saved:1.0.0 (by /u/flick-player)";
const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const OAUTH = "https://oauth.reddit.com";

function basicAuth(clientId: string): string {
  // Installed apps are public clients: Reddit issues them with no secret,
  // so the Basic auth header carries the client id with an empty password.
  return `Basic ${Buffer.from(`${clientId}:`).toString("base64")}`;
}

async function redditForm(
  clientId: string,
  body: URLSearchParams,
): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(clientId),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body,
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const msg =
      (typeof json?.error === "string" && json.error) ||
      (typeof json?.message === "string" && json.message) ||
      `Reddit token error (${res.status})`;
    throw new Error(humanRedditAuthError(msg));
  }
  return json ?? {};
}

function humanRedditAuthError(msg: string): string {
  const key = msg.toLowerCase();
  // Flick is a public client: it sends no client secret, which is only valid
  // for an "installed app". A "script"/"web app" has a secret and Reddit
  // rejects the bare client id — the most common setup mistake by far.
  if (key.includes("invalid_client") || key.includes("unauthorized") || key.includes("401")) {
    return (
      "Reddit rejected the app. At reddit.com/prefs/apps the type must be " +
      '"installed app" — not "script" or "web app". Flick never asks for a client secret.'
    );
  }
  // An authorization code is single-use, and Reddit also rejects it when the
  // redirect_uri at exchange time differs from the one at authorize time.
  if (
    key.includes("invalid_grant") ||
    key.includes("wrong_password") ||
    key.includes("unsupported_grant_type")
  ) {
    return (
      "Reddit rejected that authorization. It expires after one use — tap Authorize again, " +
      "and check the redirect URI on your app matches exactly."
    );
  }
  return `Reddit sign-in failed: ${msg}`;
}

export type TokenBundle = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  username: string;
};

function tokensFromJson(json: Record<string, unknown>, fallbackUser?: string): TokenBundle {
  const accessToken = typeof json.access_token === "string" ? json.access_token : "";
  if (!accessToken) throw new Error("Reddit did not return an access token.");
  const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : null;
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + (expiresIn - 30) * 1000,
    username: fallbackUser ?? "",
  };
}

export async function exchangeCode(input: {
  code: string;
  redirectUri: string;
  clientId: string;
}): Promise<TokenBundle> {
  const json = await redditForm(
    input.clientId,
    new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  );
  const bundle = tokensFromJson(json);
  bundle.username = await fetchMe(bundle.accessToken);
  return bundle;
}

export async function refreshGrant(input: {
  refreshToken: string;
  clientId: string;
}): Promise<TokenBundle> {
  const json = await redditForm(
    input.clientId,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    }),
  );
  const bundle = tokensFromJson(json);
  if (!bundle.refreshToken) bundle.refreshToken = input.refreshToken;
  bundle.username = await fetchMe(bundle.accessToken);
  return bundle;
}

async function oauthGet(path: string, accessToken: string): Promise<unknown> {
  const res = await fetch(`${OAUTH}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
      Cookie: "over18=1",
    },
  });
  if (res.status === 401) {
    throw new Error("Reddit session expired. Sign in again.");
  }
  if (!res.ok) {
    throw new Error(`Reddit API ${res.status} on ${path.split("?")[0]}`);
  }
  return res.json();
}

export async function fetchMe(accessToken: string): Promise<string> {
  const json = (await oauthGet("/api/v1/me", accessToken)) as Record<string, unknown>;
  const name = typeof json.name === "string" ? json.name : "";
  if (!name) throw new Error("Could not read your Reddit username.");
  return name;
}

export async function fetchSavedPage(input: {
  accessToken: string;
  username: string;
  after?: string | null;
}): Promise<SavedPage> {
  const params = new URLSearchParams({
    limit: "100",
    raw_json: "1",
    type: "links",
    include_over_18: "1",
  });
  if (input.after) params.set("after", input.after);
  const user = encodeURIComponent(input.username.replace(/^\/?u\//, ""));
  const json = await oauthGet(`/user/${user}/saved?${params.toString()}`, input.accessToken);
  const parsed = parseListingChildren(json);
  const posts = await resolveExternalVideos(parsed.posts);
  return { posts, after: parsed.after, username: input.username };
}

const REDGIFS_UA =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36";

type RedgifsAuth = { token: string; exp: number };
let redgifsAuth: RedgifsAuth | null = null;
let redgifsAuthRequest: Promise<string | null> | null = null;
let redgifsAuthFailedAt = 0;
const REDGIFS_AUTH_BACKOFF_MS = 60_000;

async function requestRedgifsToken(): Promise<string | null> {
  try {
    const res = await fetch("https://api.redgifs.com/v2/auth/temporary", {
      headers: {
        Origin: "https://www.redgifs.com",
        Referer: "https://www.redgifs.com/",
        "User-Agent": REDGIFS_UA,
      },
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as { token?: string };
    if (!json.token) {
      redgifsAuthFailedAt = Date.now();
      return null;
    }
    redgifsAuth = { token: json.token, exp: Date.now() + 6 * 60 * 60 * 1000 };
    return json.token;
  } catch {
    redgifsAuthFailedAt = Date.now();
    return null;
  }
}

/**
 * A page of saved posts can resolve a few dozen clips at once, so the token is
 * fetched once for all of them, and a failure backs off instead of firing one
 * doomed auth request per clip.
 */
function getRedgifsToken(refresh = false): Promise<string | null> {
  if (refresh) redgifsAuth = null;
  else if (redgifsAuth && redgifsAuth.exp > Date.now() + 10_000) {
    return Promise.resolve(redgifsAuth.token);
  } else if (Date.now() - redgifsAuthFailedAt < REDGIFS_AUTH_BACKOFF_MS) {
    return Promise.resolve(null);
  }
  redgifsAuthRequest ??= requestRedgifsToken().finally(() => {
    redgifsAuthRequest = null;
  });
  return redgifsAuthRequest;
}

export type RedgifsClip = {
  url: string;
  hasAudio: boolean;
  width?: number;
  height?: number;
  duration?: number;
};

type RedgifsCacheEntry = { clip: RedgifsClip | null; exp: number };
const redgifsClips = new Map<string, RedgifsCacheEntry>();
const REDGIFS_CACHE_LIMIT = 400;
/** A miss is cached briefly: an outage must not mute a clip for the session. */
const REDGIFS_MISS_TTL_MS = 2 * 60 * 1000;
const REDGIFS_HIT_TTL_MS = 6 * 60 * 60 * 1000;
/** Refresh a signed link a minute before it dies rather than on the way out. */
const REDGIFS_EXPIRY_SKEW_MS = 60 * 1000;

/**
 * Redgifs signs some CDN links (`…?expires=1693180042&signature=…`). Caching
 * one for the life of the process meant a long-lived instance could keep
 * handing out a URL that had since expired, and an expired URL is a video that
 * errors and gets skipped — so the cache entry dies with the link.
 */
function mediaUrlExpiry(url: string): number | null {
  const raw = url.match(/[?&]expires=(\d{9,})/)?.[1];
  if (!raw) return null;
  return Number(raw) * 1000;
}

function clipCacheExpiry(clip: RedgifsClip | null, now: number): number {
  if (!clip) return now + REDGIFS_MISS_TTL_MS;
  const signed = mediaUrlExpiry(clip.url);
  const ttl = signed === null ? now + REDGIFS_HIT_TTL_MS : signed - REDGIFS_EXPIRY_SKEW_MS;
  return Math.min(ttl, now + REDGIFS_HIT_TTL_MS);
}

/**
 * Fresh lookups (the player retrying a clip that just failed on the device) are
 * budgeted per process: this is a public server function, and without a cap it
 * would be a free proxy for hammering the redgifs API.
 */
const REDGIFS_FRESH_PER_MINUTE = 120;
let freshWindow = 0;
let freshUsed = 0;

function takeFreshBudget(now: number): boolean {
  const window = Math.floor(now / 60_000);
  if (window !== freshWindow) {
    freshWindow = window;
    freshUsed = 0;
  }
  if (freshUsed >= REDGIFS_FRESH_PER_MINUTE) return false;
  freshUsed += 1;
  return true;
}

/**
 * Saved-lists repeat posts across pages and every viewer re-fetches the same
 * feed, so a hit is cached (until it expires or the map is trimmed) and a miss
 * only briefly. `fresh` bypasses the cache for a player that is retrying.
 */
export async function resolveRedgifsClip(
  id: string,
  options: { fresh?: boolean } = {},
): Promise<RedgifsClip | null> {
  const key = id.trim().toLowerCase();
  const now = Date.now();
  const cached = redgifsClips.get(key);
  const fresh = options.fresh === true && takeFreshBudget(now);
  if (!fresh && cached && now < cached.exp) return cached.clip;
  const clip = await fetchRedgifs(key);
  if (redgifsClips.size >= REDGIFS_CACHE_LIMIT) redgifsClips.clear();
  redgifsClips.set(key, { clip, exp: clipCacheExpiry(clip, Date.now()) });
  return clip;
}

async function fetchRedgifs(id: string, allowRetry = true): Promise<RedgifsClip | null> {
  const token = await getRedgifsToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.redgifs.com/v2/gifs/${encodeURIComponent(id)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: "https://www.redgifs.com",
        Referer: `https://www.redgifs.com/watch/${id}`,
        "X-CustomHeader": `https://www.redgifs.com/watch/${id}`,
        "User-Agent": REDGIFS_UA,
      },
      signal: AbortSignal.timeout(8000),
    });
    // Temporary tokens are invalidated server-side without warning; one retry
    // with a brand new token is the difference between "no sound" and works.
    if ((res.status === 401 || res.status === 403) && allowRetry) {
      const fresh = await getRedgifsToken(true);
      if (fresh) return await fetchRedgifs(id, false);
      return null;
    }
    if (!res.ok) return null;
    const json = (await res.json()) as {
      gif?: {
        hasAudio?: boolean | number;
        width?: number;
        height?: number;
        duration?: number;
        urls?: { hd?: string; sd?: string };
      };
    };
    const gif = json.gif;
    // `hd` is the full-quality mp4 and carries the clip's sound; `sd` is the
    // mobile encode, used only when there is no HD master.
    const url = gif?.urls?.hd || gif?.urls?.sd;
    if (!url) return null;
    return {
      url,
      hasAudio: Boolean(gif?.hasAudio),
      width: gif?.width,
      height: gif?.height,
      duration: gif?.duration,
    };
  } catch {
    return null;
  }
}

/**
 * Runs `fn` over `items` with a bounded number of requests in flight — a saved
 * page can hold a hundred posts, and doing their lookups strictly one at a
 * time is what made the loading screen crawl.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Reddit keeps a muted copy of most redgifs clips — a `reddit_video_preview`
 * on link posts, or a mirrored v.redd.it upload — and that copy is what the
 * feed used to play: silent, lower resolution, and not the clip that was
 * posted. Whenever a post carries a redgifs id the real clip wins, even if
 * Reddit already handed us a playable video. Reddit's copy stays in place as
 * the fallback for clips redgifs no longer serves (deleted, private, API down).
 */
async function resolveExternalVideos(posts: FlickPost[]): Promise<FlickPost[]> {
  return await mapWithConcurrency(posts, 6, async (post): Promise<FlickPost> => {
    // Only a video, or a link whose destination is the clip, is really "sourced
    // by redgifs". An image or gallery post that merely credits one in its
    // title should keep showing what it actually is.
    if (post.kind !== "video" && post.kind !== "link") return post;
    const gifId = redgifsIdFromPost(post);
    if (!gifId) return post;
    const clip = await resolveRedgifsClip(gifId);
    if (!clip) return post;
    return {
      ...post,
      kind: "video",
      redgifsId: gifId,
      video: {
        // Redgifs muxes the sound into the mp4, so the primary source gets no
        // audio sidecar — attaching one would play the clip's own audio twice.
        url: clip.url,
        // Where the redgifs CDN can't be reached, Reddit's own copy still plays
        // rather than the feed skipping the post — and it keeps its own audio
        // track, so the fallback is not the silent one.
        fallbackUrl: post.video?.url,
        fallbackAudioUrls: audioCandidatesFor(post.video),
        width: clip.width ?? post.video?.width ?? 720,
        height: clip.height ?? post.video?.height ?? 1280,
        duration: clip.duration ?? post.video?.duration,
        hasAudio: clip.hasAudio,
      },
    };
  });
}

type CacheEntry = { at: number; posts: FlickPost[] };
let demoCache: CacheEntry | null = null;

const DEMO_SUBS = ["Unexpected", "nextfuckinglevel", "Damnthatsinteresting", "nsfw", "NSFW_GIF"];

export async function fetchDemoFeed(): Promise<FlickPost[]> {
  if (demoCache && Date.now() - demoCache.at < 8 * 60 * 1000) {
    return demoCache.posts;
  }
  const collected: FlickPost[] = [];
  const results = await Promise.allSettled(
    DEMO_SUBS.map(async (sub) => {
      const url = `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=${encodeURIComponent(sub)}&limit=20&sort=desc&sort_type=created_utc`;
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { data?: unknown[] };
      const rows = Array.isArray(json.data) ? json.data : [];
      return rows
        .map((row) => parseRedditPost({ kind: "t3", data: row }))
        .filter((p): p is FlickPost => p !== null);
    }),
  );
  for (const result of results) {
    if (result.status === "fulfilled") collected.push(...result.value);
  }
  const resolved = await resolveExternalVideos(collected);
  const unique = new Map<string, FlickPost>();
  for (const post of resolved) {
    if (!unique.has(post.id)) unique.set(post.id, post);
  }
  let posts = [...unique.values()];
  if (posts.length < 8) posts = [...FALLBACK_POSTS, ...posts];
  const seen = new Set<string>();
  posts = posts.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  demoCache = { at: Date.now(), posts };
  return posts;
}

const FALLBACK_POSTS: FlickPost[] = [
  {
    id: "ednnv8zyfsrh1",
    name: "t3_ednnv8zyfsrh1",
    title: "Aura loss",
    subreddit: "Unexpected",
    author: "demo",
    permalink: "https://www.reddit.com/r/Unexpected/",
    nsfw: false,
    score: 12000,
    createdUtc: Date.now() / 1000,
    kind: "video",
    video: {
      url: "https://v.redd.it/ednnv8zyfsrh1/CMAF_720.mp4?source=fallback",
      audioUrl: "https://v.redd.it/ednnv8zyfsrh1/CMAF_AUDIO_128.mp4",
      width: 720,
      height: 1280,
      hasAudio: true,
    },
  },
  {
    id: "vrzevvm55srh1",
    name: "t3_vrzevvm55srh1",
    title: "Bro meets Trump in China",
    subreddit: "Unexpected",
    author: "demo",
    permalink: "https://www.reddit.com/r/Unexpected/",
    nsfw: false,
    score: 8400,
    createdUtc: Date.now() / 1000,
    kind: "video",
    video: {
      url: "https://v.redd.it/vrzevvm55srh1/CMAF_1080.mp4?source=fallback",
      audioUrl: "https://v.redd.it/vrzevvm55srh1/CMAF_AUDIO_128.mp4",
      width: 1080,
      height: 1920,
      hasAudio: true,
    },
  },
  {
    id: "jm0t7832rrrh1",
    name: "t3_jm0t7832rrrh1",
    title: "TV Cleaning",
    subreddit: "Unexpected",
    author: "demo",
    permalink: "https://www.reddit.com/r/Unexpected/",
    nsfw: false,
    score: 5100,
    createdUtc: Date.now() / 1000,
    kind: "video",
    video: {
      url: "https://v.redd.it/jm0t7832rrrh1/CMAF_720.mp4?source=fallback",
      audioUrl: "https://v.redd.it/jm0t7832rrrh1/CMAF_AUDIO_128.mp4",
      width: 720,
      height: 1280,
      hasAudio: true,
    },
  },
  {
    id: "bvc48girnsrh1",
    name: "t3_bvc48girnsrh1",
    title: "Dress up by bf",
    subreddit: "Unexpected",
    author: "demo",
    permalink: "https://www.reddit.com/r/Unexpected/",
    nsfw: false,
    score: 2200,
    createdUtc: Date.now() / 1000,
    kind: "video",
    video: {
      url: "https://v.redd.it/bvc48girnsrh1/CMAF_480.mp4?source=fallback",
      audioUrl: "https://v.redd.it/bvc48girnsrh1/CMAF_AUDIO_128.mp4",
      width: 480,
      height: 854,
      hasAudio: true,
    },
  },
];
