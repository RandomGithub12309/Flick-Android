import { parseListingChildren, parseRedditPost, redgifsIdFromUrl } from "./parse";
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
  if (key.includes("invalid_grant") || key.includes("wrong_password")) {
    return "Reddit rejected that username or password. Accounts with two-factor auth need Authorize instead.";
  }
  if (key.includes("401") || key.includes("unauthorized") || key.includes("invalid_client")) {
    return "Reddit app ID is wrong. Open reddit.com/prefs/apps and copy it again.";
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

type RedgifsAuth = { token: string; exp: number };
let redgifsAuth: RedgifsAuth | null = null;

async function getRedgifsToken(): Promise<string | null> {
  if (redgifsAuth && redgifsAuth.exp > Date.now() + 10_000) return redgifsAuth.token;
  try {
    const res = await fetch("https://api.redgifs.com/v2/auth/temporary", {
      headers: {
        Origin: "https://www.redgifs.com",
        Referer: "https://www.redgifs.com/",
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36",
      },
    });
    const json = (await res.json()) as { token?: string };
    if (!json.token) return null;
    redgifsAuth = { token: json.token, exp: Date.now() + 6 * 60 * 60 * 1000 };
    return json.token;
  } catch {
    return null;
  }
}

async function resolveRedgifs(id: string): Promise<{ url: string; hasAudio: boolean } | null> {
  const token = await getRedgifsToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.redgifs.com/v2/gifs/${encodeURIComponent(id)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: "https://www.redgifs.com",
        Referer: `https://www.redgifs.com/watch/${id}`,
        "X-CustomHeader": `https://www.redgifs.com/watch/${id}`,
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36",
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      gif?: { hasAudio?: boolean; urls?: { hd?: string; sd?: string } };
    };
    const url = json.gif?.urls?.hd || json.gif?.urls?.sd;
    if (!url) return null;
    return { url, hasAudio: Boolean(json.gif?.hasAudio) };
  } catch {
    return null;
  }
}

function redgifsIdForPost(post: FlickPost): string | undefined {
  const candidates = [post.sourceUrl, post.permalink, post.thumbnail, post.domain].filter(
    (v): v is string => Boolean(v),
  );
  for (const c of candidates) {
    const id = redgifsIdFromUrl(c);
    if (id) return id;
  }
  return undefined;
}

async function resolveExternalVideos(posts: FlickPost[]): Promise<FlickPost[]> {
  const out: FlickPost[] = [];
  for (const post of posts) {
    if (post.video) {
      out.push(post);
      continue;
    }
    const gifId = redgifsIdForPost(post);
    if (gifId) {
      const resolved = await resolveRedgifs(gifId);
      if (resolved) {
        out.push({
          ...post,
          kind: "video",
          video: {
            url: resolved.url,
            width: 720,
            height: 1280,
            hasAudio: resolved.hasAudio,
          },
        });
        continue;
      }
    }
    out.push(post);
  }
  return out;
}

type CacheEntry = { at: number; posts: FlickPost[] };
let demoCache: CacheEntry | null = null;

const DEMO_SUBS = [
  "Unexpected",
  "nextfuckinglevel",
  "Damnthatsinteresting",
  "nsfw",
  "NSFW_GIF",
];

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
