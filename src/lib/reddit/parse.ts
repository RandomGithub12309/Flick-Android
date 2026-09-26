import type { FlickImage, FlickPost, FlickVideo } from "./types";

const MINOR_PATTERN =
  /\b(loli|shota|child porn|preteen|pre-teen|underage|under.?18|jailbait)\b/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function decodeUrl(url: string): string {
  return url.replaceAll("&", "&");
}

function redditAudioUrl(fallback: string): string | undefined {
  const decoded = decodeUrl(fallback);
  if (/CMAF_\d+\.mp4/i.test(decoded)) {
    return decoded.replace(/CMAF_\d+\.mp4/i, "CMAF_AUDIO_128.mp4");
  }
  if (/DASH_\d+[._]?\d*\.mp4/i.test(decoded)) {
    return decoded.replace(/DASH_\d+[._]?\d*\.mp4/i, "DASH_AUDIO_128.mp4");
  }
  const idMatch = decoded.match(/v\.redd\.it\/([^/?#]+)/);
  const id = idMatch?.[1];
  if (id) return `https://v.redd.it/${id}/CMAF_AUDIO_128.mp4`;
  return undefined;
}

function redditVideoFromMedia(media: unknown): FlickVideo | undefined {
  const record = asRecord(media);
  const rv = asRecord(record?.reddit_video);
  if (!rv) return undefined;
  const fallback = asString(rv.fallback_url);
  if (!fallback) return undefined;
  const width = asNumber(rv.width) ?? 720;
  const height = asNumber(rv.height) ?? 1280;
  const hasAudio = asBool(rv.has_audio) && !asBool(rv.is_gif);
  return {
    url: decodeUrl(fallback),
    audioUrl: hasAudio ? redditAudioUrl(fallback) : undefined,
    width,
    height,
    duration: asNumber(rv.duration),
    hasAudio,
  };
}

function largestPreview(data: Record<string, unknown>): FlickImage | undefined {
  const preview = asRecord(data.preview);
  const images = preview?.images;
  if (!Array.isArray(images) || images.length === 0) return undefined;
  const first = asRecord(images[0]);
  const source = asRecord(first?.source);
  const url = asString(source?.url);
  if (!url) return undefined;
  return {
    url: decodeUrl(url),
    width: asNumber(source?.width),
    height: asNumber(source?.height),
  };
}

function galleryImages(data: Record<string, unknown>): FlickImage[] | undefined {
  if (!asBool(data.is_gallery)) return undefined;
  const meta = asRecord(data.media_metadata);
  const gallery = asRecord(data.gallery_data);
  const items = gallery?.items;
  if (!meta) return undefined;
  const order: string[] = [];
  if (Array.isArray(items)) {
    for (const item of items) {
      const rec = asRecord(item);
      const id = asString(rec?.media_id);
      if (id) order.push(id);
    }
  } else {
    order.push(...Object.keys(meta));
  }
  const images: FlickImage[] = [];
  for (const id of order) {
    const entry = asRecord(meta[id]);
    if (!entry || asString(entry.status) === "failed") continue;
    const s = asRecord(entry.s);
    const url = asString(s?.u) ?? asString(s?.gif) ?? asString(s?.mp4);
    if (!url) continue;
    images.push({
      url: decodeUrl(url),
      width: asNumber(s?.x),
      height: asNumber(s?.y),
    });
  }
  return images.length > 0 ? images : undefined;
}

function isUnsafeMinorContent(title: string, subreddit: string): boolean {
  return MINOR_PATTERN.test(title) || MINOR_PATTERN.test(subreddit);
}

function imgurVideoUrl(url: string): string | undefined {
  if (/i\.imgur\.com\/.+\.gifv$/i.test(url)) return url.replace(/\.gifv$/i, ".mp4");
  if (/i\.imgur\.com\/.+\.gif$/i.test(url)) return url.replace(/\.gif$/i, ".mp4");
  return undefined;
}

function previewRedditVideo(data: Record<string, unknown>): FlickVideo | undefined {
  const preview = asRecord(data.preview);
  if (!preview?.reddit_video_preview) return undefined;
  return redditVideoFromMedia({ reddit_video: preview.reddit_video_preview });
}

export function parseRedditPost(raw: unknown): FlickPost | null {
  const listing = asRecord(raw);
  const data = asRecord(listing?.data) ?? listing;
  if (!data) return null;
  const name = asString(data.name) ?? "";
  if (name.startsWith("t1_")) return null;
  const id = asString(data.id);
  const title = asString(data.title) ?? "";
  const subreddit = asString(data.subreddit) ?? "";
  const author = asString(data.author) ?? "[deleted]";
  if (!id || !title) return null;
  if (isUnsafeMinorContent(title, subreddit)) return null;

  const permalinkPath = asString(data.permalink) ?? `/comments/${id}`;
  const permalink = permalinkPath.startsWith("http")
    ? permalinkPath
    : `https://www.reddit.com${permalinkPath}`;

  const cross = data.crosspost_parent_list;
  const sourceData =
    Array.isArray(cross) && cross.length > 0
      ? (asRecord(cross[0]) ?? data)
      : data;

  const nsfw = asBool(data.over_18) || asBool(sourceData.over_18);
  const url = asString(sourceData.url_overridden_by_dest) ?? asString(sourceData.url) ?? "";
  const domain = asString(sourceData.domain);

  let video =
    redditVideoFromMedia(sourceData.secure_media ?? sourceData.media) ??
    previewRedditVideo(sourceData);

  const imgurMp4 = url ? imgurVideoUrl(url) : undefined;
  if (!video && imgurMp4) {
    video = {
      url: imgurMp4,
      width: 720,
      height: 1280,
      hasAudio: true,
    };
  }

  const gallery = galleryImages(sourceData);
  const previewImage = largestPreview(sourceData);
  const directImage =
    /\.(jpe?g|png|webp|gif)$/i.test(url) || /i\.redd\.it\//.test(url)
      ? { url: decodeUrl(url) }
      : undefined;

  const selftext = asString(data.selftext);
  const isSelf = asBool(data.is_self);

  let kind: FlickPost["kind"] = "link";
  let image: FlickImage | undefined;
  if (video) kind = "video";
  else if (gallery && gallery.length > 0) {
    kind = "gallery";
    image = gallery[0];
  } else if (directImage) {
    kind = "image";
    image = directImage;
  } else if (previewImage) {
    kind = url && !isSelf ? "link" : "image";
    image = previewImage;
  } else if (isSelf || (selftext && selftext.length > 0)) {
    kind = "text";
  } else {
    kind = "link";
    image = previewImage;
  }

  const thumbRaw = asString(data.thumbnail);
  const thumbnail =
    thumbRaw && thumbRaw.startsWith("http") ? decodeUrl(thumbRaw) : image?.url;

  const post: FlickPost = {
    id,
    name: name || `t3_${id}`,
    title,
    subreddit,
    author,
    permalink,
    sourceUrl: url ? decodeUrl(url) : undefined,
    nsfw,
    score: asNumber(data.score) ?? 0,
    createdUtc: asNumber(data.created_utc) ?? 0,
    kind,
    video,
    image,
    gallery,
    text: selftext && selftext !== "[removed]" ? selftext : undefined,
    thumbnail,
    domain,
  };

  if (kind === "link" && !post.image && !post.video && !post.text) return null;
  return post;
}

export function parseListingChildren(raw: unknown): {
  posts: FlickPost[];
  after: string | null;
} {
  const root = asRecord(raw);
  const data = asRecord(root?.data);
  const children = data?.children;
  const posts: FlickPost[] = [];
  if (Array.isArray(children)) {
    for (const child of children) {
      const parsed = parseRedditPost(child);
      if (parsed) posts.push(parsed);
    }
  }
  const after = asString(data?.after) ?? null;
  return { posts, after };
}

export function redgifsIdFromUrl(url: string): string | undefined {
  const watch = url.match(/redgifs\.com\/(?:watch|ifr)\/([a-zA-Z0-9]+)/i);
  return watch?.[1];
}
