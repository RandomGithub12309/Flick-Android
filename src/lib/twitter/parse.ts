import { isUnsafeMinorContent } from "../content-safety";
import { asArray, asBool, asNumber, asRecord, asString } from "../coerce";
import type { FlickImage, FlickPost, FlickVideo } from "../reddit/types";

/**
 * X → `FlickPost`.
 *
 * The point of this file is that nothing downstream learns X exists: a tweet
 * comes out shaped exactly like a Reddit listing row, so the slide, the
 * player, the seek bar and the mixer all keep working. That only holds while
 * the host's quirks are absorbed here:
 *
 * - A v2 media object carries several renditions ("variants"): HLS and DASH
 *   manifests plus `mp4` files at different bit rates. Only the mp4s play in a
 *   `<video>` element, so manifests are dropped and the best mp4 wins — the
 *   same "play the real clip, not the preview" rule Flick applies to redgifs.
 * - X muxes the sound into the mp4 and never ships one for an `animated_gif`,
 *   so a tweet clip has no sidecar track (unlike a v.redd.it upload).
 * - The embed transport hands back a v1.1-shaped tweet (`full_text`,
 *   `favorite_count`, inline `extended_entities`) while the API hands back a
 *   v2-shaped one (`text`, `public_metrics`, media in `includes`). Both are
 *   read here, so the two transports stay interchangeable downstream.
 * - A quote post has no media of its own; the clip lives on the quoted tweet.
 */

/** `@nasa`, `nasa`, `https://x.com/nasa/`, `x.com/nasa` → `nasa`. */
export function normalizeHandle(input: string): string {
  let value = input.trim();
  const asUrl = value.match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/([^/?#]+)/i);
  if (asUrl?.[1]) value = asUrl[1];
  value = (value.replace(/^@+/, "").split(/[/?#]/)[0] ?? "").trim();
  return value.toLowerCase();
}

/** X handles are 1-15 characters of `[A-Za-z0-9_]`; anything else can't resolve. */
export function isHandle(value: string): boolean {
  return /^[a-z0-9_]{1,15}$/.test(value);
}

function decodeEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

/**
 * The `t.co` link X appends for attached media is the media itself, not a link
 * worth printing on the slide.
 */
function cleanTweetText(text: string): string {
  return decodeEntities(text)
    .replace(/\s*https?:\/\/t\.co\/[A-Za-z0-9]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** ISO 8601 (v2) and `Tue Jul 02 14:00:00 +0000 2024` (v1.1/embed) both appear. */
function toEpochSeconds(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = asString(value);
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

export type XVariant = {
  url: string;
  bitRate: number;
  width?: number;
  height?: number;
};

const VARIANT_SIZE = /\/(\d{2,5})x(\d{2,5})\/[^/]*\.mp4$/i;

/**
 * The rendition to play: the highest-bitrate mp4, since X encodes the same
 * clip from 320x… up to 1920x….
 *
 * `bit_rate` (v2) and `bitrate` (v1.1/embed) are both read, and a variant with
 * no stated rate still counts — the `origin` file often omits it — but sorts
 * below any that states one. Manifests (`application/x-mpegURL`, `type:
 * "hls"`) are skipped: nothing here can play them, and handing one to the
 * player is a slide that stalls then skips.
 */
export function pickMp4Variant(variants: unknown): XVariant | undefined {
  let best: XVariant | undefined;
  for (const entry of asArray(variants)) {
    const variant = asRecord(entry);
    const url = asString(variant?.url);
    if (!variant || !url) continue;
    const contentType = asString(variant.content_type) ?? "";
    const kind = asString(variant.type) ?? "";
    const isManifest =
      /mpegurl|dash|apple\s?streaming/i.test(contentType) || /^(?:hls|dash)$/i.test(kind);
    const isMp4 = /video\/mp4/i.test(contentType) || /\.mp4(?:\?|$)/i.test(url);
    if (isManifest || !isMp4) continue;
    const size = url.split(/[?#]/)[0]?.match(VARIANT_SIZE);
    const candidate: XVariant = {
      url,
      bitRate: asNumber(variant.bit_rate) ?? asNumber(variant.bitrate) ?? -1,
      width: size ? Number(size[1]) : undefined,
      height: size ? Number(size[2]) : undefined,
    };
    if (!best || candidate.bitRate > best.bitRate) best = candidate;
  }
  return best;
}

/**
 * `pbs.twimg.com` serves the full-size original under `?name=orig`; the bare
 * URL is a downscaled crop, which is exactly the wrong thing to put on a
 * full-screen slide.
 */
function photoUrl(candidate: string): string {
  const url = decodeEntities(candidate);
  if (/[?&]name=/.test(url)) return url;
  if (!/\.(?:jpe?g|png|webp)$/i.test(url.split("?")[0] ?? "")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}name=orig`;
}

function imageFromMedia(media: Record<string, unknown>): FlickImage | undefined {
  const url = asString(media.url) ?? asString(media.media_url_https) ?? asString(media.media_url);
  if (!url) return undefined;
  // The embed transport puts the real size on `original_info`, not on the media.
  const original = asRecord(media.original_info);
  return {
    url: photoUrl(url),
    width: asNumber(media.width) ?? asNumber(original?.width),
    height: asNumber(media.height) ?? asNumber(original?.height),
  };
}

/**
 * A playable clip out of one X media object, or nothing when the media is a
 * photo — or a video X only ever exposed as a manifest.
 */
export function videoFromMedia(media: unknown): FlickVideo | undefined {
  const record = asRecord(media);
  if (!record) return undefined;
  const type = asString(record.type) ?? "";
  if (type === "photo") return undefined;
  // v2 puts the renditions on the media object; the v1.1 shape the embed feed
  // returns nests them under `video_info`, with `duration_millis` beside them.
  const info = asRecord(record.video_info);
  const variant = pickMp4Variant(record.variants ?? info?.variants);
  if (!variant) return undefined;
  const dimensions = asRecord(info?.dimensions);
  const width = asNumber(record.width) ?? asNumber(dimensions?.width) ?? variant.width;
  const height = asNumber(record.height) ?? asNumber(dimensions?.height) ?? variant.height;
  const durationMs = asNumber(record.duration_ms) ?? asNumber(info?.duration_millis);
  return {
    url: decodeEntities(variant.url),
    width: width && width > 0 ? width : 720,
    height: height && height > 0 ? height : 1280,
    // Seconds, one decimal: `duration` is in seconds everywhere else in Flick.
    duration: durationMs ? Math.round(durationMs / 100) / 10 : undefined,
    // X muxes the sound into the mp4, and a GIF never has one.
    hasAudio: type !== "animated_gif",
  };
}

export type TweetMedia = Record<string, unknown>;

/** Media attached to a tweet, from either payload shape. */
function mediaForTweet(
  tweet: Record<string, unknown>,
  mediaById?: Map<string, TweetMedia>,
): TweetMedia[] {
  const attachments = asRecord(tweet.attachments);
  const keys = asArray(attachments?.media_keys)
    .map((key) => asString(key))
    .filter((key): key is string => Boolean(key));
  if (mediaById && keys.length > 0) {
    const looked: TweetMedia[] = [];
    for (const key of keys) {
      const found = mediaById.get(key);
      if (found) looked.push(found);
    }
    // A key with no media object means the post is already gone; falling back
    // to `entities` would then replay a stale URL beside nothing.
    if (looked.length > 0) return looked;
    if (keys.length > 0 && !asRecord(tweet.extended_entities)) return [];
  }
  const extended = asArray(asRecord(tweet.extended_entities)?.media);
  const inline = extended.length > 0 ? extended : asArray(asRecord(tweet.entities)?.media);
  return inline
    .map((entry) => asRecord(entry))
    .filter((entry): entry is TweetMedia => entry !== null);
}

export type TweetParseContext = {
  /** `includes.media` of a v2 response, keyed by `media_key`. */
  mediaById?: Map<string, TweetMedia>;
  /** `includes.tweets` of a v2 response, keyed by id — where a quote's media is. */
  referencedById?: Map<string, Record<string, unknown>>;
  /** Handle to attribute posts to when the payload doesn't name one. */
  account?: string;
};

function metricsOf(tweet: Record<string, unknown>): { likes: number; views: number } {
  const publicMetrics = asRecord(tweet.public_metrics);
  const likes = asNumber(publicMetrics?.like_count) ?? asNumber(tweet.favorite_count) ?? 0;
  const views = asNumber(publicMetrics?.view_count) ?? asNumber(tweet.views) ?? 0;
  return { likes, views };
}

/**
 * One tweet, from either transport, in either payload shape, into a
 * `FlickPost`.
 *
 * Returns `null` for anything this player has nothing to show: a pure-text
 * post, a media post whose only rendition is a manifest, a boost of something
 * already in the deck. A shuffle of unreadable cards is worse than a shorter
 * deck — and unlike Reddit, X's public feed is mostly conversation, so most
 * entries on the embed transport are expected to drop out here.
 */
export function parseTweet(raw: unknown, ctx: TweetParseContext = {}): FlickPost | null {
  const wrapper = asRecord(raw);
  if (!wrapper) return null;
  // The embed transport nests the tweet one level deeper, under an entry.
  const tweet = asRecord(wrapper.tweet) ?? asRecord(asRecord(wrapper.content)?.tweet) ?? wrapper;
  const id = asString(tweet.id_str) ?? asString(tweet.id);
  if (!id) return null;
  // The same rule the Reddit parser applies, from the same place: adding a
  // second host must not add a way around it.
  const body = asString(tweet.full_text) ?? asString(tweet.text) ?? "";
  if (isUnsafeMinorContent(body, asString(tweet.in_reply_to_screen_name))) return null;

  const author = asRecord(tweet.user);
  const handle =
    normalizeHandle(
      asString(author?.screen_name) ?? asString(author?.username) ?? ctx.account ?? "",
    ) || normalizeHandle(ctx.account ?? "");

  const referenced = asArray(tweet.referenced_tweets)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const quotedId =
    asString(tweet.quoted_status_id_str) ??
    asString(referenced.find((entry) => asString(entry.type) === "quoted")?.id);
  const retweetSource = asRecord(tweet.retweeted_status);
  const isBoost =
    asBool(tweet.retweeted_status_present) ||
    retweetSource !== null ||
    referenced.some((entry) => asString(entry.type) === "retweeted");
  // The v2 transport resolves a quote through `includes.tweets` (one id
  // lookup); the embed transport inlines the whole quoted tweet instead.
  const referencedTweet =
    (quotedId ? ctx.referencedById?.get(quotedId) : undefined) ??
    retweetSource ??
    asRecord(tweet.quoted_status) ??
    undefined;

  const own = mediaForTweet(tweet, ctx.mediaById);
  const media =
    own.some((entry) => videoFromMedia(entry)) || !referencedTweet
      ? own
      : mediaForTweet(referencedTweet, ctx.mediaById);

  const playable = media
    .map((entry) => ({ entry, video: videoFromMedia(entry) }))
    .filter((item): item is { entry: TweetMedia; video: FlickVideo } => Boolean(item.video));
  const photos = media
    .filter((entry) => (asString(entry.type) ?? "photo") === "photo")
    .map((entry) => imageFromMedia(entry))
    .filter((image): image is FlickImage => Boolean(image));

  const video = playable[0]?.video;
  const image = photos[0];
  // A clip plays against the still X ships beside it; a photo post is already
  // its own poster.
  // v2 names it `preview_image_url`; the embed transport reuses the media field
  // for the thumbnail, which is the same still.
  const entry = playable[0]?.entry;
  const preview = asString(entry?.preview_image_url) ?? asString(entry?.media_url_https);
  const poster: FlickImage | undefined = video
    ? preview
      ? { url: decodeEntities(preview) }
      : image
    : image;

  const text =
    cleanTweetText(asString(tweet.text) ?? asString(tweet.full_text) ?? "") ||
    (referencedTweet
      ? cleanTweetText(asString(referencedTweet.text) ?? asString(referencedTweet.full_text) ?? "")
      : "");

  let kind: FlickPost["kind"];
  if (video) kind = "video";
  else if (photos.length > 1) kind = "gallery";
  else if (image) kind = "image";
  else return null;

  const { likes, views } = metricsOf(tweet);
  const mediaViews = playable
    .map((item) => asNumber(asRecord(item.entry.public_metrics)?.view_count))
    .find((value): value is number => typeof value === "number");

  return {
    // Prefixed so a tweet and a Reddit post can never collide in the store's
    // dedupe, which keys on `id` alone.
    id: `x_${id}`,
    name: `x_${id}`,
    title: text.length > 0 ? text.slice(0, 300) : handle ? `@${handle} on X` : "Post on X",
    // `subreddit` is the Reddit lane's badge text; the X lane shows `@handle`
    // instead, so it stays empty rather than inventing an `r/` that 404s.
    subreddit: "",
    account: handle || undefined,
    author: handle || "x",
    origin: "twitter",
    permalink:
      handle && !isBoost
        ? `https://x.com/${handle}/status/${id}`
        : (asString(tweet.url) ?? (handle ? `https://x.com/${handle}` : "https://x.com/")),
    nsfw: asBool(tweet.possibly_sensitive),
    // Upvotes and likes share one slot, so "how did this land" keeps working
    // across both hosts.
    score: likes,
    // Views are the number that actually means something for a clip.
    views: mediaViews ?? (views || undefined),
    createdUtc: toEpochSeconds(tweet.created_at),
    kind,
    video,
    image: poster,
    gallery: kind === "gallery" ? photos : undefined,
    text: text || undefined,
    thumbnail: poster?.url ?? image?.url,
    domain: handle ? "x.com" : "twitter",
  };
}

/**
 * `GET /2/tweets?ids=` — the lookup the bookmarks import uses — into posts.
 *
 * `/2/users/:id/tweets` returns an identically shaped payload, so the same
 * reader covers both, and nothing here assumes the tweets share an author: an
 * import is a pile of other people&rsquo;s posts, and each slide is badged by the
 * author on the tweet rather than by a configured account.
 *
 * Only playable tweets come back. The caller counts the ids that produced
 * nothing, because "X had no answer" and "X answered with a text post" are two
 * different things to say to a person looking at a short deck.
 */
export function parseTweetList(json: unknown, account = ""): FlickPost[] {
  const root = asRecord(json);
  const includes = asRecord(root?.includes);
  const mediaById = new Map<string, TweetMedia>();
  for (const entry of asArray(includes?.media)) {
    const media = asRecord(entry);
    const key = asString(media?.media_key);
    if (media && key) mediaById.set(key, media);
  }
  const referencedById = new Map<string, Record<string, unknown>>();
  for (const entry of asArray(includes?.tweets)) {
    const tweet = asRecord(entry);
    const id = asString(tweet?.id);
    if (tweet && id) referencedById.set(id, tweet);
  }
  const usersById = new Map<string, Record<string, unknown>>();
  for (const entry of asArray(includes?.users)) {
    const user = asRecord(entry);
    const id = asString(user?.id);
    if (user && id) usersById.set(id, user);
  }

  const posts: FlickPost[] = [];
  const seen = new Set<string>();
  for (const entry of asArray(root?.data)) {
    const tweet = asRecord(entry);
    if (!tweet) continue;
    // The API names the author by id, and the slide badge needs the handle —
    // stitch the expanded user onto the tweet before parsing.
    const authorId = asString(tweet.author_id);
    const author = authorId ? usersById.get(authorId) : undefined;
    if (author && !tweet.user) tweet.user = author;
    const post = parseTweet(tweet, { mediaById, referencedById, account });
    if (!post || seen.has(post.id)) continue;
    seen.add(post.id);
    posts.push(post);
  }
  return posts;
}

/** Ids present in a lookup response, playable or not — the denominator for "missing". */
export function tweetIdsIn(json: unknown): string[] {
  const ids: string[] = [];
  for (const entry of asArray(asRecord(json)?.data)) {
    const id = asString(asRecord(entry)?.id);
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Media URLs a tweet object carries, best first.
 *
 * The importer keeps whole tweet objects when the export had them, because they
 * beat any CSV column. When the file is too big to persist those objects, this
 * salvages the one thing that makes a slide work — the playable file — so
 * shrinking the import does not shrink the deck.
 */
export function mediaUrlsOfTweet(raw: unknown): string[] {
  const wrapper = asRecord(raw);
  if (!wrapper) return [];
  const tweet = asRecord(wrapper.tweet) ?? asRecord(asRecord(wrapper.content)?.tweet) ?? wrapper;
  const urls: string[] = [];
  for (const media of mediaForTweet(tweet, undefined)) {
    const video = videoFromMedia(media);
    if (video) {
      urls.push(video.url);
      continue;
    }
    const image = imageFromMedia(media);
    if (image) urls.push(image.url);
  }
  return urls;
}
