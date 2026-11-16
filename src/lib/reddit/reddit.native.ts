import { CapacitorHttp } from "@capacitor/core";
import { ensureLocalServer } from "./native-server";
import { parseListingChildren, parseRedditPost, redgifsIdFromPost } from "./parse";
import { redgifsProxyUrl } from "./redgifs";
import { audioCandidatesFor } from "../video-sources";
import type { FlickPost, SavedPage } from "./types";

const USER_AGENT = "android:app.flick.saved:1.0.0 (by /u/flick-player)";
const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const OAUTH = "https://oauth.reddit.com";
const REDGIFS_UA =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36";

function basicAuth(clientId: string): string {
  return `Basic ${btoa(`${clientId}:`)}`;
}

function humanRedditAuthError(msg: string): string {
  const key = msg.toLowerCase();
  if (key.includes("invalid_client") || key.includes("unauthorized") || key.includes("401")) {
    return (
      "Reddit rejected the app. At reddit.com/prefs/apps the type must be " +
      '"installed app" — not "script" or "web app". Flick never asks for a client secret.'
    );
  }
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

function parseJsonData(data: unknown): Record<string, unknown> | null {
  if (data && typeof data === "object") return data as Record<string, unknown>;
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

async function redditForm(
  clientId: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await CapacitorHttp.request({
    url: TOKEN_URL,
    method: "POST",
    headers: {
      Authorization: basicAuth(clientId),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    data: new URLSearchParams(params).toString(),
  });
  const json = parseJsonData(res.data);
  if (res.status < 200 || res.status >= 300) {
    const msg =
      (typeof json?.error === "string" && json.error) ||
      (typeof json?.message === "string" && json.message) ||
      `Reddit token error (${res.status})`;
    throw new Error(humanRedditAuthError(msg));
  }
  return json ?? {};
}

async function oauthGet(path: string, accessToken: string): Promise<unknown> {
  const res = await CapacitorHttp.request({
    url: `${OAUTH}${path}`,
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
      Cookie: "over18=1",
    },
  });
  if (res.status === 401) {
    throw new Error("Reddit session expired. Sign in again.");
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Reddit API ${res.status} on ${path.split("?")[0]}`);
  }
  return typeof res.data === "string" ? JSON.parse(res.data) : res.data;
}

async function fetchMe(accessToken: string): Promise<string> {
  const json = (await oauthGet("/api/v1/me", accessToken)) as Record<string, unknown>;
  const name = typeof json.name === "string" ? json.name : "";
  if (!name) throw new Error("Could not read your Reddit username.");
  return name;
}

export async function nativeExchangeCode(input: {
  code: string;
  redirectUri: string;
  clientId: string;
}): Promise<TokenBundle> {
  const json = await redditForm(input.clientId, {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  const bundle = tokensFromJson(json);
  bundle.username = await fetchMe(bundle.accessToken);
  return bundle;
}

export async function nativeRefreshGrant(input: {
  refreshToken: string;
  clientId: string;
}): Promise<TokenBundle> {
  const json = await redditForm(input.clientId, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
  const bundle = tokensFromJson(json);
  if (!bundle.refreshToken) bundle.refreshToken = input.refreshToken;
  bundle.username = await fetchMe(bundle.accessToken);
  return bundle;
}

type RedgifsAuth = { token: string; exp: number };
let redgifsAuth: RedgifsAuth | null = null;
let redgifsAuthRequest: Promise<string | null> | null = null;
let redgifsAuthFailedAt = 0;

async function requestRedgifsToken(): Promise<string | null> {
  try {
    const res = await CapacitorHttp.request({
      url: "https://api.redgifs.com/v2/auth/temporary",
      method: "GET",
      headers: {
        Origin: "https://www.redgifs.com",
        Referer: "https://www.redgifs.com/",
        "User-Agent": REDGIFS_UA,
      },
      connectTimeout: 8000,
      readTimeout: 8000,
    });
    const json = parseJsonData(res.data) as { token?: string } | null;
    if (!json?.token) {
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

function getRedgifsToken(refresh = false): Promise<string | null> {
  if (refresh) redgifsAuth = null;
  else if (redgifsAuth && redgifsAuth.exp > Date.now() + 10_000) {
    return Promise.resolve(redgifsAuth.token);
  } else if (Date.now() - redgifsAuthFailedAt < 60_000) {
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

const redgifsClips = new Map<string, { clip: RedgifsClip | null; exp: number }>();

async function fetchRedgifsMeta(id: string, allowRetry = true): Promise<RedgifsClip | null> {
  await ensureLocalServer();
  const token = await getRedgifsToken();
  if (!token) return null;
  try {
    const res = await CapacitorHttp.request({
      url: `https://api.redgifs.com/v2/gifs/${encodeURIComponent(id)}`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: "https://www.redgifs.com",
        Referer: `https://www.redgifs.com/watch/${id}`,
        "X-CustomHeader": `https://www.redgifs.com/watch/${id}`,
        "User-Agent": REDGIFS_UA,
      },
      connectTimeout: 8000,
      readTimeout: 8000,
    });
    if ((res.status === 401 || res.status === 403) && allowRetry) {
      const fresh = await getRedgifsToken(true);
      if (fresh) return await fetchRedgifsMeta(id, false);
      return null;
    }
    if (res.status < 200 || res.status >= 300) return null;
    const json = parseJsonData(res.data) as {
      gif?: {
        hasAudio?: boolean | number;
        width?: number;
        height?: number;
        duration?: number;
        urls?: { hd?: string; sd?: string };
      };
    } | null;
    const gif = json?.gif;
    if (!gif?.urls?.hd && !gif?.urls?.sd) return null;
    return {
      url: redgifsProxyUrl(id),
      hasAudio: Boolean(gif.hasAudio),
      width: gif.width,
      height: gif.height,
      duration: gif.duration,
    };
  } catch {
    return null;
  }
}

export async function nativeResolveRedgifsClip(
  id: string,
  options: { fresh?: boolean } = {},
): Promise<RedgifsClip | null> {
  const key = id.trim().toLowerCase();
  const now = Date.now();
  const cached = redgifsClips.get(key);
  if (!options.fresh && cached && now < cached.exp) return cached.clip;
  const clip = await fetchRedgifsMeta(key);
  if (redgifsClips.size >= 400) redgifsClips.clear();
  redgifsClips.set(key, { clip, exp: Date.now() + (clip ? 6 * 60 * 60 * 1000 : 2 * 60 * 1000) });
  return clip;
}

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

async function resolveExternalVideos(posts: FlickPost[]): Promise<FlickPost[]> {
  await ensureLocalServer();
  return await mapWithConcurrency(posts, 6, async (post): Promise<FlickPost> => {
    if (post.kind !== "video" && post.kind !== "link") return post;
    const gifId = redgifsIdFromPost(post);
    if (!gifId) return post;
    const clip = await nativeResolveRedgifsClip(gifId);
    if (!clip) return post;
    return {
      ...post,
      kind: "video",
      redgifsId: gifId,
      video: {
        url: clip.url,
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

export async function nativeFetchSavedPage(input: {
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

const DEMO_SUBS = ["Unexpected", "nextfuckinglevel", "Damnthatsinteresting", "nsfw", "NSFW_GIF"];

export async function nativeFetchDemoFeed(subreddits?: string[]): Promise<FlickPost[]> {
  const subs = subreddits && subreddits.length > 0 ? subreddits : DEMO_SUBS;
  const collected: FlickPost[] = [];
  const results = await Promise.allSettled(
    subs.map(async (sub) => {
      const clean = sub.replace(/^\/?r\//i, "").trim();
      if (!clean) return [];
      const url = `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=${encodeURIComponent(clean)}&limit=20&sort=desc&sort_type=created_utc`;
      const res = await CapacitorHttp.request({
        url,
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
        connectTimeout: 8000,
        readTimeout: 8000,
      });
      if (res.status < 200 || res.status >= 300) throw new Error(String(res.status));
      const json = (typeof res.data === "string" ? JSON.parse(res.data) : res.data) as {
        data?: unknown[];
      };
      const rows = Array.isArray(json?.data) ? json.data : [];
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
  return [...unique.values()];
}

export async function nativeUnsavePost(input: {
  accessToken: string;
  fullname: string;
}): Promise<void> {
  const res = await CapacitorHttp.request({
    url: `${OAUTH}/api/unsave`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    data: new URLSearchParams({ id: input.fullname }).toString(),
  });
  if (res.status === 401) {
    throw new Error("Reddit session expired. Sign in again.");
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Could not unsave post (${res.status})`);
  }
}
