import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { ensureLocalServer } from "@/lib/reddit/native-server";
import type { FlickVideo, RedditComment } from "@/lib/reddit/types";
import {
  findGetMediaUrl,
  parsePornhubCommentsHtml,
  parsePornhubSearchHtml,
  parsePornhubWatchHtml,
  selectPornhubVideoSources,
} from "./parse";
import type { PornhubMediaDefinition, PornhubSearchResult, PornhubSort } from "./types";

const PH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const PH_HEADERS: Record<string, string> = {
  "User-Agent": PH_UA,
  Cookie: "accessAgeDisclaimerPH=1; platform=pc",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.pornhub.com/",
};

const VIDEO_CACHE_TTL_MS = 8 * 60 * 1000;
const COMMENTS_CACHE_TTL_MS = 10 * 60 * 1000;

const videoCache = new Map<string, { video: FlickVideo; at: number }>();
const videoInFlight = new Map<string, Promise<FlickVideo | null>>();
const commentsCache = new Map<string, { comments: RedditComment[]; at: number }>();

function proxifyPornhubUrl(url: string | undefined, origin: string): string | undefined {
  if (!url || !origin) return url;
  if (url.startsWith("https://")) {
    return `${origin}/api/pornhub/video?url=${encodeURIComponent(url)}`;
  }
  return url;
}

async function fetchPageText(url: string, extraHeaders?: Record<string, string>): Promise<string> {
  const headers = { ...PH_HEADERS, ...extraHeaders };
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.request({
      url,
      method: "GET",
      headers,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Pornhub request failed (${res.status})`);
    }
    return typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? "");
  }

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Pornhub request failed (${res.status})`);
  return res.text();
}

export async function searchPornhubVideos(
  query: string,
  options: { page?: number; sort?: PornhubSort } = {},
): Promise<PornhubSearchResult[]> {
  const clean = query.trim();
  if (!clean) return [];
  const sp = new URLSearchParams();
  sp.set("search", clean);
  if (options.sort && options.sort !== "relevance") {
    sp.set("o", options.sort);
  }
  if (options.page && options.page > 1) {
    sp.set("page", String(options.page));
  }
  const url = `https://www.pornhub.com/video/search?${sp.toString()}`;
  const html = await fetchPageText(url);
  return parsePornhubSearchHtml(html);
}

export async function resolvePornhubVideo(
  viewkey: string,
  options: { fresh?: boolean } = {},
): Promise<FlickVideo | null> {
  const key = viewkey.trim();
  if (!key) return null;

  if (!options.fresh) {
    const cached = videoCache.get(key);
    if (cached && Date.now() - cached.at < VIDEO_CACHE_TTL_MS) {
      return cached.video;
    }
  }

  const inflightKey = `${options.fresh ? "fresh" : "cached"}:${key}`;
  const existing = videoInFlight.get(inflightKey);
  if (existing) return existing;

  const task = (async (): Promise<FlickVideo | null> => {
    try {
      const watchUrl = `https://www.pornhub.com/view_video.php?viewkey=${encodeURIComponent(key)}`;
      const html = await fetchPageText(watchUrl);
      const parsed = parsePornhubWatchHtml(html, key);

      if (parsed.comments.length > 0) {
        commentsCache.set(key, { comments: parsed.comments, at: Date.now() });
      }

      let resolvedMp4s: PornhubMediaDefinition[] = [];
      const getMediaUrl = findGetMediaUrl(parsed.mediaDefinitions);
      if (getMediaUrl) {
        try {
          const mediaText = await fetchPageText(getMediaUrl, { Referer: watchUrl });
          const raw = JSON.parse(mediaText) as unknown;
          if (Array.isArray(raw)) {
            resolvedMp4s = raw.filter(
              (m): m is PornhubMediaDefinition => Boolean(m && typeof m === "object"),
            );
          }
        } catch {
          // Fall back to any direct URLs in mediaDefinitions
        }
      }

      const selected = selectPornhubVideoSources(parsed.mediaDefinitions, resolvedMp4s);
      if (!selected) return null;

      const origin = await ensureLocalServer();
      const video: FlickVideo = {
        url: proxifyPornhubUrl(selected.url, origin) ?? selected.url,
        fallbackUrl: proxifyPornhubUrl(selected.fallbackUrl, origin),
        fallbackUrls: selected.fallbackUrls?.map((u) => proxifyPornhubUrl(u, origin) ?? u),
        width: 1280,
        height: 720,
        duration: parsed.durationSeconds,
        hasAudio: true,
      };
      videoCache.set(key, { video, at: Date.now() });
      return video;
    } catch {
      return null;
    } finally {
      videoInFlight.delete(inflightKey);
    }
  })();

  videoInFlight.set(inflightKey, task);
  return task;
}

export async function fetchPornhubComments(viewkey: string): Promise<RedditComment[]> {
  const key = viewkey.trim();
  if (!key) return [];

  const cached = commentsCache.get(key);
  if (cached && Date.now() - cached.at < COMMENTS_CACHE_TTL_MS) {
    return cached.comments;
  }

  const watchUrl = `https://www.pornhub.com/view_video.php?viewkey=${encodeURIComponent(key)}`;
  const html = await fetchPageText(watchUrl);
  const parsed = parsePornhubWatchHtml(html, key);
  let comments = parsed.comments;

  if (comments.length === 0 && parsed.videoId) {
    try {
      const commentUrl = `https://www.pornhub.com/comment/show?id=${encodeURIComponent(parsed.videoId)}&popular=1&what=video`;
      const frag = await fetchPageText(commentUrl, {
        Referer: watchUrl,
        "X-Requested-With": "XMLHttpRequest",
      });
      comments = parsePornhubCommentsHtml(frag);
    } catch {
      // Return empty if comment endpoint fails
    }
  }

  commentsCache.set(key, { comments, at: Date.now() });
  return comments;
}

export async function fetchPornhubCreatorVideos(options: {
  author: string;
  authorUrl?: string;
  page?: number;
}): Promise<PornhubSearchResult[]> {
  const page = options.page ?? 1;
  const candidateUrls: string[] = [];

  if (options.authorUrl && options.authorUrl.startsWith("https://www.pornhub.com/")) {
    const base = options.authorUrl.replace(/\/+$/, "");
    const videosBase = base.endsWith("/videos") ? base : `${base}/videos`;
    candidateUrls.push(page > 1 ? `${videosBase}?page=${page}` : videosBase);
    if (videosBase !== base) {
      candidateUrls.push(page > 1 ? `${base}?page=${page}` : base);
    }
  } else {
    const slug = options.author
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (slug) {
      const base = `https://www.pornhub.com/model/${encodeURIComponent(slug)}/videos`;
      candidateUrls.push(page > 1 ? `${base}?page=${page}` : base);
    }
  }

  for (const url of candidateUrls) {
    try {
      const html = await fetchPageText(url);
      const parsed = parsePornhubSearchHtml(html);
      if (parsed.length > 0) return parsed;
    } catch {
      // Try next candidate URL or fall back to creator search
    }
  }

  return searchPornhubVideos(options.author, { page });
}
