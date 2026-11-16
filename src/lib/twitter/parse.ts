import type { FlickImage, FlickPost, FlickVideo, RedditComment } from "@/lib/reddit/types";

type UnknownRecord = Record<string, unknown>;

function asRecord(v: unknown): UnknownRecord | null {
  return v && typeof v === "object" ? (v as UnknownRecord) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Parses either a raw Cookie header (`auth_token=...; ct0=...`) or
 * individual token strings into `{ authToken, ct0 }`.
 */
export function parseTwitterCookies(
  authTokenOrCookie: string,
  ct0Input?: string,
): { authToken: string; ct0: string } | null {
  const trimmed = authTokenOrCookie.trim();
  if (!trimmed) return null;

  if (ct0Input && ct0Input.trim()) {
    const authToken = trimmed.replace(/^auth_token=/i, "").trim();
    const ct0 = ct0Input.trim().replace(/^ct0=/i, "").trim();
    if (authToken && ct0) return { authToken, ct0 };
  }

  let authToken = "";
  let ct0 = "";
  for (const part of trimmed.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "auth_token") authToken = v;
    if (k === "ct0") ct0 = v;
  }
  if (authToken && ct0) return { authToken, ct0 };
  return null;
}

/** Strips trailing t.co media shortlinks from tweet text so captions read cleanly. */
function cleanTweetText(raw: string): string {
  return raw.replace(/\s*https:\/\/t\.co\/[A-Za-z0-9]+$/g, "").trim();
}

function parseTweetDateUtc(createdAt: string): number {
  if (!createdAt) return 0;
  const ms = Date.parse(createdAt);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function unwrapTweetResult(raw: unknown): UnknownRecord | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const typeName = asString(rec.__typename);
  if (typeName === "TweetTombstone" || typeName === "TweetUnavailable") return null;
  if (rec.tweet) return unwrapTweetResult(rec.tweet);
  return rec;
}

function extractMediaFromLegacy(legacy: UnknownRecord): {
  kind: FlickPost["kind"];
  video?: FlickVideo;
  image?: FlickImage;
  gallery?: FlickImage[];
} {
  const ext = asRecord(legacy.extended_entities);
  const ent = asRecord(legacy.entities);
  const mediaList = asArray(ext?.media ?? ent?.media)
    .map(asRecord)
    .filter((m): m is UnknownRecord => m !== null);

  if (mediaList.length === 0) {
    const urls = asArray(ent?.urls);
    return { kind: urls.length > 0 ? "link" : "text" };
  }

  const videoItem = mediaList.find(
    (m) => m.type === "video" || m.type === "animated_gif",
  );
  if (videoItem) {
    const info = asRecord(videoItem.video_info);
    const variants = asArray(info?.variants)
      .map(asRecord)
      .filter((v): v is UnknownRecord => v !== null && v.content_type === "video/mp4" && typeof v.url === "string")
      .sort((a, b) => asNumber(b.bitrate) - asNumber(a.bitrate));

    const best = variants[0];
    if (best) {
      const orig = asRecord(videoItem.original_info);
      const width = asNumber(orig?.width, 1280);
      const height = asNumber(orig?.height, 720);
      const durationMs = asNumber(info?.duration_millis, 0);
      const posterUrl = asString(videoItem.media_url_https);
      const fallback = variants[1];

      const video: FlickVideo = {
        url: asString(best.url),
        fallbackUrl: fallback ? asString(fallback.url) : undefined,
        width,
        height,
        duration: durationMs > 0 ? durationMs / 1000 : undefined,
        hasAudio: videoItem.type === "video",
      };
      const image: FlickImage | undefined = posterUrl
        ? { url: posterUrl, width, height }
        : undefined;
      return { kind: "video", video, image };
    }
  }

  const photos: FlickImage[] = mediaList
    .filter((m) => typeof m.media_url_https === "string")
    .map((m) => {
      const orig = asRecord(m.original_info);
      return {
        url: asString(m.media_url_https),
        width: asNumber(orig?.width) || undefined,
        height: asNumber(orig?.height) || undefined,
      };
    });

  if (photos.length > 1) {
    return { kind: "gallery", gallery: photos, image: photos[0] };
  }
  if (photos.length === 1) {
    return { kind: "image", image: photos[0] };
  }
  return { kind: "text" };
}

export function parseTweetResult(raw: unknown): FlickPost | null {
  const tweet = unwrapTweetResult(raw);
  if (!tweet) return null;

  const legacy = asRecord(tweet.legacy);
  if (!legacy) return null;

  const id = asString(tweet.rest_id) || asString(legacy.id_str);
  if (!id) return null;

  const core = asRecord(tweet.core);
  const userResult = unwrapTweetResult(asRecord(core?.user_results)?.result);
  const userLegacy = asRecord(userResult?.legacy);
  const userCore = asRecord(userResult?.core);
  const screenName =
    asString(userCore?.screen_name) || asString(userLegacy?.screen_name) || "x";

  const noteTweet = asRecord(asRecord(asRecord(tweet.note_tweet)?.note_tweet_results)?.result);
  const fullText = asString(noteTweet?.text) || asString(legacy.full_text);
  const title = cleanTweetText(fullText) || `Post by @${screenName}`;

  const media = extractMediaFromLegacy(legacy);
  if (media.kind === "text" || media.kind === "link") {
    // Keep text-only/link tweets out only if caller filters; FlickPost supports them too,
    // matching Reddit's media-focused deck by skipping non-media tweets unless quoted media exists.
    const quoted = asRecord(asRecord(tweet.quoted_status_result)?.result);
    if (quoted) {
      const qPost = parseTweetResult(quoted);
      if (qPost && (qPost.kind === "video" || qPost.kind === "image" || qPost.kind === "gallery")) {
        return {
          ...qPost,
          id,
          name: `x_${id}`,
          platform: "twitter",
          title: `${title}\n\n@${qPost.author}: ${qPost.title}`,
          author: screenName,
          permalink: `https://x.com/${screenName}/status/${id}`,
        };
      }
    }
    return null;
  }

  return {
    id,
    name: `x_${id}`,
    platform: "twitter",
    title,
    subreddit: "X",
    author: screenName,
    permalink: `https://x.com/${screenName}/status/${id}`,
    nsfw: Boolean(legacy.possibly_sensitive),
    score: asNumber(legacy.favorite_count),
    createdUtc: parseTweetDateUtc(asString(legacy.created_at)),
    kind: media.kind,
    video: media.video,
    image: media.image,
    gallery: media.gallery,
    thumbnail: media.image?.url,
    domain: "x.com",
  };
}

function extractTimelineInstructions(instructions: unknown[]): {
  posts: FlickPost[];
  cursor: string | null;
} {
  const posts: FlickPost[] = [];
  let cursor: string | null = null;

  for (const instr of instructions) {
    const rec = asRecord(instr);
    if (!rec) continue;
    const entries = asArray(rec.entries);
    for (const entry of entries) {
      const eRec = asRecord(entry);
      if (!eRec) continue;
      const entryId = asString(eRec.entryId);
      const content = asRecord(eRec.content);
      if (!content) continue;

      if (entryId.startsWith("cursor-bottom-") || content.cursorType === "Bottom") {
        const val = asString(content.value);
        if (val) cursor = val;
        continue;
      }

      const itemContent = asRecord(content.itemContent);
      const tweetRes = asRecord(itemContent?.tweet_results)?.result;
      if (tweetRes) {
        const parsed = parseTweetResult(tweetRes);
        if (parsed) posts.push(parsed);
        continue;
      }

      // Some timelines wrap items in TimelineTimelineModule (`items` array)
      const items = asArray(content.items);
      for (const sub of items) {
        const subItem = asRecord(asRecord(sub)?.item);
        const subTweet = asRecord(asRecord(subItem?.itemContent)?.tweet_results)?.result;
        if (subTweet) {
          const parsed = parseTweetResult(subTweet);
          if (parsed) posts.push(parsed);
        }
      }
    }
  }

  return { posts, cursor };
}

export function parseBookmarksTimeline(json: unknown): {
  posts: FlickPost[];
  cursor: string | null;
} {
  const root = asRecord(json);
  const data = asRecord(root?.data);
  const tl =
    asRecord(asRecord(data?.bookmark_timeline_v2)?.timeline) ??
    asRecord(asRecord(data?.bookmark_timeline)?.timeline);
  const instructions = asArray(tl?.instructions);
  return extractTimelineInstructions(instructions);
}

export function parseUserMediaTimeline(json: unknown): {
  posts: FlickPost[];
  cursor: string | null;
} {
  const root = asRecord(json);
  const user = asRecord(asRecord(asRecord(root?.data)?.user)?.result);
  const tl =
    asRecord(asRecord(user?.timeline_v2)?.timeline) ??
    asRecord(asRecord(user?.timeline)?.timeline);
  const instructions = asArray(tl?.instructions);
  return extractTimelineInstructions(instructions);
}

export function parseTweetDetailComments(
  json: unknown,
  focalTweetId: string,
): RedditComment[] {
  const root = asRecord(json);
  const conv = asRecord(asRecord(root?.data)?.threaded_conversation_with_injections_v2);
  const instructions = asArray(conv?.instructions);
  const comments: RedditComment[] = [];

  const pushTweet = (raw: unknown) => {
    const tweet = unwrapTweetResult(raw);
    if (!tweet) return;
    const legacy = asRecord(tweet.legacy);
    if (!legacy) return;
    const id = asString(tweet.rest_id) || asString(legacy.id_str);
    if (!id || id === focalTweetId) return;

    const core = asRecord(tweet.core);
    const user = unwrapTweetResult(asRecord(core?.user_results)?.result);
    const userLegacy = asRecord(user?.legacy);
    const userCore = asRecord(user?.core);
    const author =
      asString(userCore?.screen_name) || asString(userLegacy?.screen_name) || "x";
    const body = cleanTweetText(asString(legacy.full_text));
    if (!body) return;

    comments.push({
      id,
      author,
      body,
      score: asNumber(legacy.favorite_count),
      createdUtc: parseTweetDateUtc(asString(legacy.created_at)),
    });
  };

  for (const instr of instructions) {
    const rec = asRecord(instr);
    if (!rec) continue;
    for (const entry of asArray(rec.entries)) {
      const eRec = asRecord(entry);
      const content = asRecord(eRec?.content);
      if (!content) continue;
      const itemContent = asRecord(content.itemContent);
      const tweetRes = asRecord(itemContent?.tweet_results)?.result;
      if (tweetRes) pushTweet(tweetRes);

      for (const sub of asArray(content.items)) {
        const subItem = asRecord(asRecord(sub)?.item);
        const subTweet = asRecord(asRecord(subItem?.itemContent)?.tweet_results)?.result;
        if (subTweet) pushTweet(subTweet);
      }
    }
  }

  return comments;
}
