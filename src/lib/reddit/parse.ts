import { redgifsProxyUrl, type ClipPlayback } from "./redgifs";
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
  return url.replaceAll("&amp;", "&");
}

/** `v.redd.it/<media id>/…`, and the signed CDN host Reddit also serves mp4s from. */
const REDDIT_MEDIA_HOST = /^https?:\/\/(?:v|packaged-media)\.redd\.it\/([^/?#]+)\//i;

const CMAF_AUDIO_FILES = ["CMAF_AUDIO_128.mp4", "CMAF_AUDIO_64.mp4"];
const DASH_AUDIO_FILES = ["DASH_AUDIO_128.mp4", "DASH_AUDIO_64.mp4", "DASH_audio.mp4"];

/**
 * Reddit stores every video and its audio as two separate files. Newer uploads
 * are CMAF (`CMAF_720.mp4` + `CMAF_AUDIO_128.mp4`); older ones are DASH
 * (`DASH_720.mp4` + `DASH_AUDIO_128.mp4`), and pre-2023 DASH clips use a
 * lowercase `DASH_audio.mp4`. Guessing one name is how a video ends up silent,
 * so return every plausible audio URL in preference order and let the player
 * walk the list until one loads.
 */
function redditAudioCandidates(videoUrl: string): string[] {
  const base = decodeUrl(videoUrl).split("?")[0];
  const candidates: string[] = [];
  const add = (url: string) => {
    if (!candidates.includes(url)) candidates.push(url);
  };
  const swap = (matched: string, names: string[]) => {
    const stem = base.slice(0, base.length - matched.length);
    for (const name of names) add(stem + name);
  };

  const cmaf = base.match(/CMAF_[A-Za-z0-9_]+\.mp4$/i);
  if (cmaf) swap(cmaf[0], CMAF_AUDIO_FILES);
  const dash = base.match(/DASH_[A-Za-z0-9_]+\.mp4$/i);
  if (dash) swap(dash[0], DASH_AUDIO_FILES);

  // A signed CDN URL rejects a rewritten file name, but the media id in it is
  // the same one `v.redd.it` serves, so try the plain audio paths there too.
  const id = base.match(REDDIT_MEDIA_HOST)?.[1];
  if (id) {
    for (const name of [...CMAF_AUDIO_FILES, ...DASH_AUDIO_FILES]) {
      add(`https://v.redd.it/${id}/${name}`);
    }
  }
  return candidates;
}

function redditVideoFromMedia(media: unknown): FlickVideo | undefined {
  const record = asRecord(media);
  const rv = asRecord(record?.reddit_video);
  if (!rv) return undefined;
  const fallback = asString(rv.fallback_url);
  if (!fallback) return undefined;
  const width = asNumber(rv.width) ?? 720;
  const height = asNumber(rv.height) ?? 1280;
  const url = decodeUrl(fallback);
  // `has_audio` is missing from some older payloads, and a preview that has no
  // audio track simply 404s the candidates below — one wasted request is
  // cheaper than a silent video, so only an explicit `false` means "silent".
  const hasAudio = !asBool(rv.is_gif) && rv.has_audio !== false;
  const audioUrls = hasAudio ? redditAudioCandidates(url) : [];
  return {
    url,
    audioUrl: audioUrls[0],
    audioUrls: audioUrls.length > 0 ? audioUrls : undefined,
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

/**
 * `media.redgifs.com` serves the clip files themselves, and their names are the
 * clip id in CamelCase with a variant suffix: `ZealousGreenShark.mp4`,
 * `…-mobile.mp4`, `…-silent.mp4`, `…-poster.jpg`. Reddit thumbnails of a
 * redgifs link often point straight at the `-mobile.jpg`, so this is another
 * way to recover the id for a post whose `url` is not a watch link.
 */
const REDGIFS_MEDIA_FILE =
  /\/([A-Za-z0-9]+)(?:-(?:mobile|silent|hd|medium|poster|thumbnail|vthumbnail))?\.(mp4|webm|jpe?g)$/i;

/**
 * Recover a clip id from a redgifs *media* URL, e.g.
 * `https://media.redgifs.com/ZealousGreenShark-mobile.mp4` -> `zealousgreenshark`.
 */
export function redgifsIdFromMediaUrl(url: string): string | undefined {
  if (!/^https?:\/\/(?:[\w-]+\.)*redgifs\.com\//i.test(url)) return undefined;
  const path = url.split(/[?#]/)[0];
  const match = path.match(REDGIFS_MEDIA_FILE);
  return match?.[1]?.toLowerCase();
}

/**
 * A redgifs clip file used directly as a post's link — `…/Foo.mp4`, or the
 * `-silent` cut, which tells us there is no sound to fetch.
 *
 * On the web it plays through the proxy, not as-is: the CDN validates
 * UA/Referer per request and 403s a bare browser fetch. On a device there is no
 * proxy, so the CDN link is kept verbatim and `RedgifsWebViewClient` replays it
 * with those headers — which is why the parser has to be told which of the two
 * it's producing, or a natively-parsed post would carry a `/api/redgifs/…` URL
 * that resolves to nothing inside the app.
 */
export function redgifsMediaVideo(
  url: string,
  playback: ClipPlayback = "proxy",
): { url: string; hasAudio: boolean } | undefined {
  const id = redgifsIdFromMediaUrl(url);
  if (!id) return undefined;
  const path = url.split(/[?#]/)[0];
  if (!/\.(?:mp4|webm)$/i.test(path)) return undefined;
  return {
    url: playback === "direct" ? url : redgifsProxyUrl(id),
    hasAudio: !/-silent\.(?:mp4|webm)$/i.test(path),
  };
}

/**
 * A redgifs clip can be referenced from several places in a listing, and the
 * one that matters differs by post type: a plain link post carries it in
 * `url`, an embed carries it in the oembed iframe, a repost usually carries it
 * in the crosspost parent, and the "sauce in the title" kind only in the title.
 */
function redgifsIdFromRaw(
  data: Record<string, unknown>,
  source: Record<string, unknown>,
): string | undefined {
  const fields: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string" && value.length > 0) fields.push(value);
  };

  for (const record of [data, source]) {
    add(record.url);
    add(record.url_overridden_by_dest);
    add(record.permalink);
    add(record.title);
    add(record.selftext);
    add(record.domain);
    // Link posts carry Reddit's own thumbnail, which for a redgifs link is
    // frequently the clip's `-mobile.jpg` on the redgifs CDN.
    add(record.thumbnail);
    for (const key of ["media", "secure_media"]) {
      add(asRecord(asRecord(record[key])?.oembed)?.html);
    }
    for (const key of ["media_embed", "secure_media_embed"]) {
      const embed = asRecord(record[key]);
      add(embed?.content);
      add(embed?.media_domain_url);
    }
  }

  for (const field of fields) {
    const id = redgifsIdFromUrl(field) ?? redgifsIdFromMediaUrl(field);
    if (id) return id;
  }
  return undefined;
}

/** Redgifs ids are lowercase alphanumeric words, e.g. `zealousgreenshark`. */
export function redgifsIdFromUrl(url: string): string | undefined {
  const match = url.match(/redgifs\.com\/(?:watch|ifr|shorts|v2\/gifs)\/([a-zA-Z0-9]+)/i);
  return match?.[1];
}

/**
 * Best-effort redgifs id for an already-parsed post. Used server-side to swap
 * Reddit's muted copy of a redgifs clip for the real thing.
 */
export function redgifsIdFromPost(post: FlickPost): string | undefined {
  if (post.redgifsId) return post.redgifsId;
  const candidates = [
    post.sourceUrl,
    post.permalink,
    post.thumbnail,
    post.domain,
    post.title,
    post.text,
    post.image?.url,
    post.video?.url,
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const id = redgifsIdFromUrl(candidate) ?? redgifsIdFromMediaUrl(candidate);
    if (id) return id;
  }
  return undefined;
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

export function parseRedditPost(
  raw: unknown,
  playback: ClipPlayback = "proxy",
): FlickPost | null {
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

  // A post that links a redgifs clip file directly (…/Foo.mp4, or the `-silent`
  // cut) is a video in its own right. The id comes along with it, so the server
  // can still upgrade it to the HD copy with sound when the API cooperates.
  const redgifsMedia = url ? redgifsMediaVideo(url, playback) : undefined;
  if (!video && redgifsMedia) {
    video = {
      url: redgifsMedia.url,
      width: 720,
      height: 1280,
      hasAudio: redgifsMedia.hasAudio,
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
  if (video) {
    kind = "video";
    // Preview still is the letterbox backdrop when the clip is landscape.
    image = previewImage;
  } else if (gallery && gallery.length > 0) {
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
    redgifsId: redgifsIdFromRaw(data, sourceData),
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

  // A bare redgifs link post (no Reddit thumbnail to fall back on) is still
  // worth keeping: the server resolves the clip and turns it into a video.
  if (kind === "link" && !post.image && !post.video && !post.text && !post.redgifsId) {
    return null;
  }
  return post;
}

export function parseListingChildren(
  raw: unknown,
  playback: ClipPlayback = "proxy",
): {
  posts: FlickPost[];
  after: string | null;
} {
  const root = asRecord(raw);
  const data = asRecord(root?.data);
  const children = data?.children;
  const posts: FlickPost[] = [];
  if (Array.isArray(children)) {
    for (const child of children) {
      const parsed = parseRedditPost(child, playback);
      if (parsed) posts.push(parsed);
    }
  }
  const after = asString(data?.after) ?? null;
  return { posts, after };
}
