import type { FlickPost, RedditComment } from "@/lib/reddit/types";
import type { PornhubMediaDefinition, PornhubSearchResult } from "./types";

const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#039;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

export function decodeHtmlEntities(input: string): string {
  if (!input) return "";
  return input
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#0?39);/gi, (m) => NAMED_ENTITIES[m.toLowerCase()] ?? m)
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
    });
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

export function parseDurationToSeconds(text: string): number | undefined {
  const clean = text.trim();
  if (!clean) return undefined;
  const parts = clean.split(":").map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  return undefined;
}

function parseCompactCount(text: string): number {
  const clean = text.trim().replace(/,/g, "").toUpperCase();
  const m = clean.match(/^(\d+(?:\.\d+)?)\s*([KMB])?/);
  if (!m) return 0;
  const num = Number.parseFloat(m[1]!);
  if (!Number.isFinite(num)) return 0;
  const mult = m[2] === "B" ? 1e9 : m[2] === "M" ? 1e6 : m[2] === "K" ? 1e3 : 1;
  return Math.round(num * mult);
}

function normalizeHttpsUrl(raw: string): string {
  const clean = decodeHtmlEntities(raw).trim();
  if (!clean) return "";
  if (clean.startsWith("//")) return `https:${clean}`;
  if (clean.startsWith("http://")) return `https://${clean.slice(7)}`;
  return clean;
}

/**
 * Extracts video search results (title, thumbnail, duration, views, rating, channel)
 * from Pornhub's `/video/search` HTML page.
 */
export function parsePornhubSearchHtml(html: string): PornhubSearchResult[] {
  if (!html) return [];
  const results: PornhubSearchResult[] = [];
  const seen = new Set<string>();

  // Match each video list item block that carries a `data-video-vkey` attribute.
  const itemRegex =
    /<li\b[^>]*data-video-vkey=["']([a-zA-Z0-9]+)["'][^>]*>([\s\S]*?)<\/li>/gi;

  for (const match of html.matchAll(itemRegex)) {
    const viewkey = match[1]?.trim();
    const block = match[2] ?? "";
    if (!viewkey || seen.has(viewkey)) continue;

    // Skip premium-only / ad promo cards that don't link to a free watch page.
    if (
      /class=["'][^"']*(?:phpFree|premiumIcon|modelhub)[^"']*["']/i.test(block) &&
      !block.includes(`viewkey=${viewkey}`)
    ) {
      continue;
    }

    const titleMatch =
      block.match(
        /<a\b[^>]*href=["'][^"']*viewkey=[^"']*["'][^>]*title=["']([^"']+)["']/i,
      ) ??
      block.match(
        /<a\b[^>]*title=["']([^"']+)["'][^>]*href=["'][^"']*viewkey=[^"']*["']/i,
      ) ??
      block.match(/<span\b[^>]*class=["'][^"']*title[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i) ??
      block.match(/<img\b[^>]*alt=["']([^"']+)["']/i);
    const title = titleMatch?.[1] ? stripTags(titleMatch[1]) : "";
    if (!title) continue;

    const thumbMatch =
      block.match(/data-mediumthumb=["']([^"']+)["']/i) ??
      block.match(/data-thumb_url=["']([^"']+)["']/i) ??
      block.match(/data-src=["']([^"']+)["']/i) ??
      block.match(/<img\b[^>]*src=["']([^"']+)["']/i);
    const thumbnail = thumbMatch?.[1] ? normalizeHttpsUrl(thumbMatch[1]) : "";
    if (!thumbnail || thumbnail.startsWith("data:")) continue;

    const durationMatch = block.match(/<var\b[^>]*class=["'][^"']*duration[^"']*["'][^>]*>([^<]+)<\/var>/i);
    const duration = durationMatch?.[1] ? durationMatch[1].trim() : "";

    const viewsMatch = block.match(/<span\b[^>]*class=["'][^"']*views[^"']*["'][^>]*>[\s\S]*?<var>([^<]+)<\/var>/i);
    const views = viewsMatch?.[1] ? viewsMatch[1].trim() : undefined;

    const ratingMatch = block.match(/<div\b[^>]*class=["'][^"']*value[^"']*["'][^>]*>([^<]+%)<\/div>/i);
    const rating = ratingMatch?.[1] ? ratingMatch[1].trim() : undefined;

    const authorMatch =
      block.match(/<div\b[^>]*class=["'][^"']*usernameWrap[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i) ??
      block.match(/<a\b[^>]*data-mxptype=["'][^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    const author = authorMatch?.[1] ? stripTags(authorMatch[1]) : "Pornhub";

    seen.add(viewkey);
    results.push({
      viewkey,
      title,
      thumbnail,
      duration,
      durationSeconds: parseDurationToSeconds(duration),
      views,
      rating,
      author: author || "Pornhub",
      permalink: `https://www.pornhub.com/view_video.php?viewkey=${encodeURIComponent(viewkey)}`,
    });
  }

  return results;
}

/**
 * Extracts a balanced JSON object literal starting at `startIndex` (pointing at `{`).
 */
function extractJsonObject(src: string, startIndex: number): string | null {
  if (src[startIndex] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(startIndex, i + 1);
    }
  }
  return null;
}

export type ParsedPornhubWatch = {
  viewkey: string;
  videoId?: string;
  title?: string;
  author?: string;
  thumbnail?: string;
  durationSeconds?: number;
  mediaDefinitions: PornhubMediaDefinition[];
  comments: RedditComment[];
};

export function parsePornhubWatchHtml(html: string, viewkey: string): ParsedPornhubWatch {
  let mediaDefinitions: PornhubMediaDefinition[] = [];
  let title: string | undefined;
  let thumbnail: string | undefined;
  let durationSeconds: number | undefined;
  let videoId: string | undefined;

  const fvMatch = html.match(/var\s+flashvars_(\d+)\s*=\s*\{/);
  if (fvMatch && fvMatch.index != null) {
    videoId = fvMatch[1];
    const braceStart = html.indexOf("{", fvMatch.index);
    const jsonStr = braceStart >= 0 ? extractJsonObject(html, braceStart) : null;
    if (jsonStr) {
      try {
        const fv = JSON.parse(jsonStr) as Record<string, unknown>;
        if (typeof fv.video_title === "string") title = decodeHtmlEntities(fv.video_title);
        if (typeof fv.image_url === "string") thumbnail = normalizeHttpsUrl(fv.image_url);
        if (typeof fv.video_duration === "number" && Number.isFinite(fv.video_duration)) {
          durationSeconds = fv.video_duration;
        }
        if (Array.isArray(fv.mediaDefinitions)) {
          mediaDefinitions = fv.mediaDefinitions.filter(
            (m): m is PornhubMediaDefinition => Boolean(m && typeof m === "object"),
          );
        }
      } catch {
        // Fall through to regex extraction below
      }
    }
  }

  // Fallback: extract `mediaDefinitions` array directly if flashvars JSON had JS expressions.
  if (mediaDefinitions.length === 0) {
    const mdMatch = html.match(/"mediaDefinitions"\s*:\s*(\[[\s\S]*?\])\s*,\s*"/);
    if (mdMatch?.[1]) {
      try {
        const parsed = JSON.parse(mdMatch[1]) as unknown[];
        mediaDefinitions = parsed.filter(
          (m): m is PornhubMediaDefinition => Boolean(m && typeof m === "object"),
        );
      } catch {
        // Ignore
      }
    }
  }

  const authorMatch =
    html.match(/<div\b[^>]*class=["'][^"']*usernameBadgesWrapper[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i) ??
    html.match(/<a\b[^>]*class=["'][^"']*bolded[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
  const author = authorMatch?.[1] ? stripTags(authorMatch[1]) : undefined;

  return {
    viewkey,
    videoId,
    title,
    author,
    thumbnail,
    durationSeconds,
    mediaDefinitions,
    comments: parsePornhubCommentsHtml(html),
  };
}

function numericQuality(q: PornhubMediaDefinition["quality"]): number {
  if (typeof q === "number" && Number.isFinite(q)) return q;
  if (typeof q === "string") {
    const parsed = Number.parseInt(q, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (Array.isArray(q) && q.length > 0) {
    return Math.max(...q.map((item) => numericQuality(item)));
  }
  return 0;
}

/**
 * Finds any `get_media` JSON endpoint URL inside `mediaDefinitions` (which
 * Pornhub uses to serve the direct MP4 quality list).
 */
export function findGetMediaUrl(definitions: PornhubMediaDefinition[]): string | null {
  const mp4Endpoint = definitions.find(
    (d) =>
      d.format === "mp4" &&
      typeof d.videoUrl === "string" &&
      d.videoUrl.includes("/video/get_media"),
  );
  if (mp4Endpoint?.videoUrl) return normalizeHttpsUrl(mp4Endpoint.videoUrl);

  const anyEndpoint = definitions.find(
    (d) => typeof d.videoUrl === "string" && d.videoUrl.includes("/video/get_media"),
  );
  return anyEndpoint?.videoUrl ? normalizeHttpsUrl(anyEndpoint.videoUrl) : null;
}

/**
 * Picks the best ordered video source list (highest-quality MP4 down to lower
 * MP4s, with HLS `.m3u8` as a final fallback).
 */
export function selectPornhubVideoSources(
  definitions: PornhubMediaDefinition[],
  resolvedMp4s: PornhubMediaDefinition[] = [],
): { url: string; fallbackUrl?: string; fallbackUrls?: string[] } | null {
  const mp4Candidates = [...resolvedMp4s, ...definitions]
    .filter(
      (d): d is PornhubMediaDefinition & { videoUrl: string } =>
        d.format === "mp4" &&
        typeof d.videoUrl === "string" &&
        d.videoUrl.length > 0 &&
        !d.videoUrl.includes("/video/get_media"),
    )
    .sort((a, b) => numericQuality(b.quality) - numericQuality(a.quality))
    .map((d) => normalizeHttpsUrl(d.videoUrl));

  const hlsCandidates = definitions
    .filter(
      (d): d is PornhubMediaDefinition & { videoUrl: string } =>
        d.format === "hls" && typeof d.videoUrl === "string" && d.videoUrl.length > 0,
    )
    .sort((a, b) => numericQuality(b.quality) - numericQuality(a.quality))
    .map((d) => normalizeHttpsUrl(d.videoUrl));

  const ordered = [...new Set([...mp4Candidates, ...hlsCandidates])].filter(Boolean);
  if (ordered.length === 0) return null;

  const [url, ...rest] = ordered;
  return {
    url: url!,
    fallbackUrl: rest[0],
    fallbackUrls: rest.length > 0 ? rest : undefined,
  };
}

/**
 * Parses comments from a Pornhub watch page or `/comment/show` HTML fragment.
 */
export function parsePornhubCommentsHtml(html: string): RedditComment[] {
  if (!html) return [];
  const comments: RedditComment[] = [];
  const seen = new Set<string>();

  // Keep the opening commentBlock tag attributes so `data-comment-id` / `id="cmt_..."` survive.
  const parts = html.split(/(<div\b[^>]*class=["'][^"']*\bcommentBlock\b[^"']*["'][^>]*>)/i);
  for (let i = 1; i < parts.length; i += 2) {
    const openTag = parts[i] ?? "";
    const bodyHtml = (parts[i + 1] ?? "").slice(0, 3500);
    const chunk = openTag + bodyHtml;
    const idMatch =
      chunk.match(/data-comment-id=["'](\d+)["']/i) ??
      chunk.match(/id=["']cmt_(\d+)["']/i);
    const id = idMatch?.[1] ?? `ph-cmt-${(i + 1) / 2}`;
    if (seen.has(id)) continue;

    const msgMatch =
      chunk.match(/<div\b[^>]*class=["'][^"']*\bcommentMessage\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ??
      chunk.match(/<span\b[^>]*class=["'][^"']*\bcommentMessage\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const body = msgMatch?.[1] ? stripTags(msgMatch[1]) : "";
    if (!body || body === "This comment has been deleted.") continue;

    const authorMatch =
      chunk.match(/<a\b[^>]*class=["'][^"']*\busernameLink\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i) ??
      chunk.match(/<div\b[^>]*class=["'][^"']*\busernameWrap\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i);
    const author = authorMatch?.[1] ? stripTags(authorMatch[1]) : "Anonymous";

    const voteMatch = chunk.match(/<span\b[^>]*class=["'][^"']*\bvoteTotal\b[^"']*["'][^>]*>([^<]+)<\/span>/i);
    const score = voteMatch?.[1] ? Number.parseInt(voteMatch[1].replace(/[^\d-]/g, ""), 10) || 0 : 0;

    seen.add(id);
    comments.push({
      id,
      author: author || "Anonymous",
      body,
      score,
      createdUtc: 0,
    });
  }

  return comments;
}

export function searchResultToFlickPost(item: PornhubSearchResult): FlickPost {
  return {
    id: `ph_${item.viewkey}`,
    name: `ph_${item.viewkey}`,
    platform: "pornhub",
    pornhubKey: item.viewkey,
    title: item.title,
    subreddit: "Pornhub",
    author: item.author || "Pornhub",
    permalink: item.permalink,
    nsfw: true,
    score: item.views ? parseCompactCount(item.views) : 0,
    createdUtc: 0,
    kind: "video",
    image: item.thumbnail ? { url: item.thumbnail, width: 1280, height: 720 } : undefined,
    thumbnail: item.thumbnail || undefined,
    domain: "pornhub.com",
  };
}
