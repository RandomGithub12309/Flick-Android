import { isUnsafeMinorContent } from "../content-safety";
import { asArray, asNumber, asRecord, asString } from "../coerce";
import type { FlickPost, FlickVideo } from "../reddit/types";
import { mediaUrlsOfTweet, normalizeHandle, parseTweet } from "./parse";
import type { BookmarkEntry, BookmarkImport } from "./types";

/**
 * Reading a person's X bookmarks export.
 *
 * X has no export button for bookmarks — the archive it mails you covers your
 * own tweets, likes and account data, not what you saved from other people — so
 * a "bookmarks" file arrives in whatever shape the tool that produced it
 * picked. Three shapes cover the realistic set, and all three are read here:
 *
 * - **CSV** from the browser exporters, one tweet per row, header names that
 *   vary by tool (`Tweet URL`, `tweet_id`, `Media URLs`). Column *position* is
 *   never stable enough to trust, so rows are joined to headers by name.
 * - **JSON / JSONL** of full tweet objects — either the v1.1 shape
 *   (`tweets.js`, `like.js` from an account archive) or a richer exporter's
 *   own dump. These are the best case: they carry media variants, dimensions
 *   and counts, so they parse through the same function an API response does
 *   and need no network at all.
 * - **A list of ids or status URLs**, one per line — the floor. Needs a token to
 *   resolve, but takes ten seconds to paste.
 *
 * Two rules hold throughout:
 *
 * - **Never invent an id.** An entry without a resolvable tweet id is counted
 *   as rejected and reported, not guessed at from a row number.
 * - **Never trust a number.** X ids are 19 digits, past `Number.MAX_SAFE_INTEGER`:
 *   a JSON id parsed as a number is already rounded before this file can see
 *   it, and a rounded id 404s forever with no clue as to why. So numeric ids
 *   are re-quoted out of the text first (`protectBigIntIds`).
 */

/** Beyond this the file is a database, and the deck would never reach the end. */
export const MAX_ENTRIES = 3000;

/**
 * Ceiling on what one shuffle sends to X for lookup.
 *
 * Bookmark libraries run to tens of thousands; a swipeable deck does not. The
 * mixer trims the lane to a share of the deck anyway, so hydrating more than
 * this spends rate limit on posts that were never going to be seen.
 */
export const HYDRATE_LIMIT = 200;

const STATUS_URL = /(?:^|\/)(?:i\/)?(?:status|statuses)\/(\d{1,25})/i;
const HANDLE_IN_URL = /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/\d{1,25}/i;
/** Captured, not just matched: `exec(...)[1]` is the id, and a group-less
 *  pattern makes the prose fallback return null for every input. */
const DIGITS = /(\d{5,25})/;

/** Extract a tweet id from a status URL or a bare id, and nothing else. */
export function extractTweetId(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  // Excel and Sheets like to wrap long numbers in a formula: `="1234567890"`.
  const unwrapped = raw.replace(/^["'=\s]+/, "").replace(/["'\s]+$/, "");
  const fromUrl = unwrapped.match(STATUS_URL);
  if (fromUrl?.[1]) return fromUrl[1];
  // A cell of nothing but digits is unambiguous, however short: the oldest
  // tweets on the platform have two-digit ids, and rejecting those would drop
  // real bookmarks for a rule that only exists to guard the fallback below.
  if (/^\d{1,25}$/.test(unwrapped)) return unwrapped;
  // A number *inside* prose has to earn its keep, or "see page 42" becomes an id.
  return DIGITS.exec(unwrapped)?.[1] ?? null;
}

/**
 * A stable key for a row that names a media file but no tweet.
 *
 * FNV-1a over the URL, base36. Not a tweet id and never passed as one — it only
 * has to be the same string next time the same file is imported, so a re-import
 * updates slides instead of duplicating them. That is the whole reason this is
 * allowed where "guess an id from the row number" is not.
 */
function fileKey(url: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `file_${hash.toString(36)}`;
}

const ANY_URL = /https?:\/\/[^\s"',;]+/gi;
const FILE_LOOKS_LIKE_MEDIA = /\.(mp4|m4v|mov|webm|jpe?g|png|webp|gif|avif)(\?|$)/i;

/**
 * Split a pasted line into "the tweet link" and "the media link".
 *
 * This is what makes a token-free import possible: the tweet URL alone is not
 * playable (its video path contains an opaque per-upload hash that nothing can
 * derive), but the address copied from the player *is*, and both fit on one
 * line separated by a space or a comma.
 */
function splitLine(line: string): { tweetUrl?: string; media: string[] } {
  const urls = line.match(ANY_URL) ?? [];
  const media: string[] = [];
  let tweetUrl: string | undefined;
  for (const url of urls) {
    if (!tweetUrl && STATUS_URL.test(url)) {
      tweetUrl = url;
      continue;
    }
    // Photos count: a slide is a slide, and `postFromEntry` prefers the video
    // when a row carries both. Filtering images here would contradict the CSV
    // reader, which keeps them.
    if (FILE_LOOKS_LIKE_MEDIA.test(url) || /twimg\.com/i.test(url)) media.push(url);
  }
  return { tweetUrl, media };
}

/** `x.com/nasa/status/123` → `nasa`, so a URL-only export still gets a badge. */
function handleFromStatusUrl(value: string): string | undefined {
  const match = value.match(HANDLE_IN_URL);
  const handle = match?.[1] ? normalizeHandle(match[1]) : "";
  return handle && handle !== "i" ? handle : undefined;
}

/**
 * Re-quote 16+ digit JSON numbers before parsing.
 *
 * Applied to the raw text because `JSON.parse` has already rounded by the time
 * an object exists. The pattern needs a `:` and a trailing comma/brace, which a
 * digit run inside a string value cannot satisfy — `,"url":"…1234567890123456789…"}`
 * never matches because the digits there are preceded by a quote, not a colon.
 */
function protectBigIntIds(text: string): string {
  return text.replace(
    /([{,]\s*"[A-Za-z0-9_]+"|"[A-Za-z0-9_]+")\s*:\s*(\d{16,})(\s*[,\]}])/g,
    '$1:"$2"$3',
  );
}

/**
 * Append an entry, keeping one entry per tweet.
 *
 * The same tweet shows up twice in real exports constantly — a bookmark listed
 * in both the "all" and a folder view, a thread posted twice — and the count on
 * the panel is meant to be "how many slides this can make", so double-counting
 * would be a small lie with a visible cost. When the two rows differ, the richer
 * one wins: an exporter that writes a bare id first and the full object later
 * must not lose the media, since that is the difference between a slide and a
 * lookup.
 */
function addEntry(
  entries: BookmarkEntry[],
  indexById: Map<string, number>,
  entry: BookmarkEntry,
): void {
  const at = indexById.get(entry.id);
  if (at === undefined) {
    indexById.set(entry.id, entries.length);
    entries.push(entry);
    return;
  }
  const existing = entries[at] as BookmarkEntry;
  const richness = (e: BookmarkEntry) => (e.raw ? 2 : 0) + (e.mediaUrls?.length ? 1 : 0);
  if (richness(entry) > richness(existing)) entries[at] = entry;
}

/** Split on the delimiter the file actually uses, judged from its header line. */
function detectDelimiter(line: string): string {
  const counts: [string, number][] = [
    [",", (line.match(/,/g) ?? []).length],
    ["\t", (line.match(/\t/g) ?? []).length],
    [";", (line.match(/;/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return (counts[0]?.[1] ?? 0) > 0 ? (counts[0][0] as string) : ",";
}

/**
 * A small CSV reader, because the exports are not clean enough for `split(",")`.
 *
 * Handles quoted fields with embedded commas and newlines, `""` escaping, CRLF,
 * a UTF-8 BOM, and a trailing empty line. That is the whole feature set — there
 * is no quote-inside-unquoted-field recovery here, because no exporter writes
 * that, and a row that fails to parse loses its media column at worst.
 */
function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);
  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ""));
}

const COLUMN_KEYS = {
  id: ["tweet id", "tweet id str", "id str", "status id", "post id", "id"],
  url: ["tweet url", "url", "link", "permalink", "tweet link", "status url", "tweet permalink"],
  text: ["tweet text", "text", "full text", "content", "body", "tweet"],
  account: [
    "author handle username",
    "author handle",
    "handle",
    "username",
    "screen name",
    "user",
    "author",
    "account",
  ],
  // Candidates are matched against *normalized* headers, and normalization drops
  // a trailing "(UTC)" — which is exactly what the exporters write — so the
  // bare form has to be listed, not the parenthesised one.
  date: [
    "tweet timestamp",
    "created at",
    "created",
    "tweet date",
    "timestamp",
    "date",
    "time",
    "bookmark captured time",
  ],
  media: [
    "media urls",
    "media url",
    "media links",
    "media",
    "video urls",
    "video url",
    "videos",
    "images",
    "assets",
  ],
} as const;

type ColumnKey = keyof typeof COLUMN_KEYS;

function normalizeHeader(cell: string): string {
  return cell
    .toLowerCase()
    .replace(/^\ufeff/, "")
    .replace(/["']/g, "")
    .replace(/[_\-.]/g, " ")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Exact match first, then containment, so `Tweet URL (canonical)` still lands. */
function mapColumns(header: string[]): Partial<Record<ColumnKey, number>> {
  const names = header.map(normalizeHeader);
  const found: Partial<Record<ColumnKey, number>> = {};
  for (const [key, candidates] of Object.entries(COLUMN_KEYS) as [ColumnKey, readonly string[]][]) {
    let index = -1;
    for (const candidate of candidates) {
      index = names.indexOf(candidate);
      if (index >= 0) break;
    }
    if (index < 0) {
      for (const candidate of candidates) {
        if (candidate.length < 3) continue;
        const loose = names.findIndex((name) => name.startsWith(`${candidate} `));
        if (loose >= 0) {
          index = loose;
          break;
        }
      }
    }
    if (index >= 0 && !Object.values(found).includes(index)) found[key] = index;
  }
  return found;
}

const MEDIA_SPLIT = /[\s,;|]+/;

function mediaFromCell(cell: string | undefined): string[] {
  if (!cell) return [];
  return cell
    .split(MEDIA_SPLIT)
    .map((token) => token.replace(/^["'<]+|["'>,]+$/g, ""))
    .filter((token) => /^https?:\/\//i.test(token) && !/\.m3u8(?:\?|$)/i.test(token))
    .slice(0, 8);
}

function toEpochSeconds(value: string | undefined): number | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const numeric = Number(raw);
  // Unix seconds and milliseconds both appear in the wild; a 13-digit value is
  // milliseconds and would otherwise be dated to the 4000s.
  if (Number.isFinite(numeric) && /^\d{10,13}$/.test(raw)) {
    return raw.length > 11 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined;
}

/** Rows of a CSV, matched to their headers, into entries. */
function entriesFromCsv(text: string): { entries: BookmarkEntry[]; rejected: number } {
  const delimiter = detectDelimiter(text.split(/\r?\n/, 1)[0] ?? "");
  const rows = parseCsvRows(text, delimiter);
  const header = rows[0];
  if (!header) return { entries: [], rejected: 0 };
  const columns = mapColumns(header);
  // No id and no URL means nothing to look up; a text-only CSV is a list of
  // captions, not a bookmarks file.
  if (columns.id === undefined && columns.url === undefined) {
    return { entries: [], rejected: Math.max(0, rows.length - 1) };
  }
  const entries: BookmarkEntry[] = [];
  const indexById = new Map<string, number>();
  let rejected = 0;
  for (const row of rows.slice(1)) {
    const cell = (key: ColumnKey): string | undefined => {
      const at = columns[key];
      return at === undefined ? undefined : row[at];
    };
    const url = cell("url")?.trim() ?? "";
    const id = extractTweetId(cell("id")) ?? extractTweetId(url);
    if (!id) {
      rejected += 1;
      continue;
    }
    const entry: BookmarkEntry = { id };
    if (/^https?:\/\//i.test(url)) entry.url = url;
    const handle = cell("account") ? normalizeHandle(cell("account") as string) : "";
    if (handle) entry.account = handle;
    else {
      const fromUrl = entry.url ? handleFromStatusUrl(entry.url) : undefined;
      if (fromUrl) entry.account = fromUrl;
    }
    const text = cell("text")?.trim();
    if (text) entry.title = text.slice(0, 500);
    const at = toEpochSeconds(cell("date"));
    if (at) entry.createdAt = at;
    const media = mediaFromCell(cell("media"));
    if (media.length > 0) entry.mediaUrls = media;
    addEntry(entries, indexById, entry);
    if (entries.length >= MAX_ENTRIES) break;
  }
  return { entries, rejected };
}

/**
 * Does this object describe a tweet, or just point at one?
 *
 * Decides whether to carry the object whole (and get variants, dimensions and
 * counts from it) or keep only the reference fields. Media is the tell: an
 * export row without any media structure is metadata about a bookmark.
 */
function looksLikeTweet(candidate: Record<string, unknown>): boolean {
  return (
    asArray(candidate.extended_entities).length > 0 ||
    asArray(asRecord(candidate.media)?.all).length > 0 ||
    asRecord(candidate.entities) !== null ||
    asRecord(candidate.user) !== null ||
    asNumber(candidate.favorite_count) !== undefined ||
    asString(candidate.full_text) !== undefined
  );
}

function entryFromObject(raw: unknown): BookmarkEntry | null {
  const wrapper = asRecord(raw);
  if (!wrapper) return null;
  // Archive files nest the tweet under a `tweet` key; exporters that wrap for
  // context nest it under `content.tweet` or `item`.
  const tweet =
    asRecord(wrapper.tweet) ??
    asRecord(asRecord(wrapper.content)?.tweet) ??
    asRecord(wrapper.item) ??
    asRecord(wrapper.status) ??
    wrapper;
  const id =
    extractTweetId(tweet.id_str) ??
    extractTweetId(tweet.id) ??
    extractTweetId(wrapper.tweetId) ??
    extractTweetId(wrapper.id) ??
    extractTweetId(asString(wrapper.url) ?? asString(wrapper.permalink));
  if (!id) return null;
  const entry: BookmarkEntry = { id };
  const url = asString(tweet.url) ?? asString(wrapper.url) ?? asString(wrapper.permalink);
  if (url && /^https?:\/\//i.test(url)) entry.url = url;
  const author = asRecord(tweet.user);
  const handle = normalizeHandle(
    asString(author?.screen_name) ??
      asString(author?.username) ??
      asString(wrapper.authorHandle) ??
      asString(wrapper.handle) ??
      "",
  );
  if (handle) entry.account = handle;
  const text = asString(tweet.full_text) ?? asString(tweet.text) ?? asString(wrapper.text);
  if (text) entry.title = text.slice(0, 500);
  const at = toEpochSeconds(asString(tweet.created_at) ?? asString(wrapper.created_at));
  if (at) entry.createdAt = at;
  const media = mediaFromCell(asString(wrapper.media) ?? asString(wrapper.mediaUrls));
  if (media.length > 0) entry.mediaUrls = media;
  // Full objects are carried whole and parsed like an API tweet; the flat
  // fields above stay as what survives `shrinkImport` if the file is too big.
  if (tweet !== wrapper || looksLikeTweet(tweet)) entry.raw = tweet;
  return entry;
}

function firstArray(value: Record<string, unknown>): unknown[] {
  for (const key of ["bookmarks", "tweets", "items", "entries", "data", "results"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
  }
  for (const candidate of Object.values(value)) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [value];
}

function entriesFromJson(text: string): {
  entries: BookmarkEntry[];
  rejected: number;
  format: "json" | "jsonl";
} {
  const guarded = protectBigIntIds(text);
  let rows: unknown[] | null = null;
  try {
    const parsed = JSON.parse(guarded) as unknown;
    rows = Array.isArray(parsed) ? parsed : firstArray(asRecord(parsed) ?? {});
  } catch {
    rows = null;
  }
  // JSONL: an exporter that streamed objects one per line is not invalid JSON as
  // a file, just not as a document, so it gets its own pass rather than an error.
  let format: "json" | "jsonl" = "json";
  if (rows === null) {
    format = "jsonl";
    rows = [];
    for (const line of guarded.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        rows.push(JSON.parse(trimmed) as unknown);
      } catch {
        rows.push(null);
      }
    }
  }
  const entries: BookmarkEntry[] = [];
  const indexById = new Map<string, number>();
  let rejected = 0;
  for (const row of rows) {
    // A JSON array of ids and status URLs is a thing people hand-write.
    if (typeof row === "string" || typeof row === "number") {
      const id = extractTweetId(row);
      if (!id) {
        rejected += 1;
        continue;
      }
      const entry: BookmarkEntry = { id };
      if (typeof row === "string" && /^https?:\/\//i.test(row)) {
        entry.url = row;
        const handle = handleFromStatusUrl(row);
        if (handle) entry.account = handle;
      }
      entries.push(entry);
      continue;
    }
    const entry = entryFromObject(row);
    if (!entry) {
      rejected += 1;
      continue;
    }
    addEntry(entries, indexById, entry);
    if (entries.length >= MAX_ENTRIES) break;
  }
  return { entries, rejected, format };
}

function entriesFromLines(text: string): { entries: BookmarkEntry[]; rejected: number } {
  const entries: BookmarkEntry[] = [];
  const indexById = new Map<string, number>();
  let rejected = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^\/\//.test(trimmed)) continue;
    const { tweetUrl, media } = splitLine(trimmed);
    // The digits-only fallback applies to a line that is a bare id, never to a
    // URL: twimg video paths embed the tweet id (`ext_tw_video/<id>/pu/vid/…`),
    // so reading one out of the path would *look* right on the common case and
    // be wrong on everything else — a `pbs.twimg.com/media/…` photo has no id
    // there at all, and a `?tag=12` would do just as well. Guessing an id is how
    // a deck ends up playing the wrong clip.
    const fromUrl = tweetUrl ? extractTweetId(tweetUrl) : null;
    const fromBare = /^https?:\/\//i.test(trimmed) ? null : extractTweetId(trimmed);
    const id = fromUrl ?? fromBare;
    let entry: BookmarkEntry | null = null;
    if (id) entry = { id };
    else if (media[0]) entry = { id: fileKey(media[0]), synthetic: true };
    if (!entry) {
      rejected += 1;
      continue;
    }
    if (tweetUrl) {
      entry.url = tweetUrl;
      const handle = handleFromStatusUrl(tweetUrl);
      if (handle) entry.account = handle;
    }
    if (media.length > 0) entry.mediaUrls = media;
    addEntry(entries, indexById, entry);
    if (entries.length >= MAX_ENTRIES) break;
  }
  return { entries, rejected };
}

/** A file where every line is an id or a status URL — no headers involved. */
function looksLikeIdList(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("//"))
    .slice(0, 12);
  if (lines.length === 0) return false;
  // Whole-line only. A CSV row `1675…, "some text"` also contains a long run of
  // digits, and reading it as a list would silently discard its other columns.
  return lines.every(
    (line) => /^\d{1,25}$/.test(line) || (/^https?:\/\//i.test(line) && STATUS_URL.test(line)),
  );
}

/**
 * Read any of the accepted shapes. Throws only when nothing in the file was a
 * tweet — a caller cannot do anything useful with an empty deck, and the
 * message is what the settings screen shows.
 */
export function parseBookmarksFile(text: string, fileName = "pasted"): BookmarkImport {
  const body = text.replace(/^\ufeff/, "").trim();
  if (!body) throw new Error("That file is empty.");
  const startsJson = body.startsWith("[") || body.startsWith("{");
  let entries: BookmarkEntry[] = [];
  let rejected = 0;
  let format: BookmarkImport["format"] = "csv";

  if (startsJson) {
    const parsed = entriesFromJson(body);
    entries = parsed.entries;
    rejected = parsed.rejected;
    format = parsed.format;
  } else if (looksLikeIdList(body)) {
    const parsed = entriesFromLines(body);
    entries = parsed.entries;
    rejected = parsed.rejected;
    format = "ids";
  } else {
    const parsed = entriesFromCsv(body);
    entries = parsed.entries;
    rejected = parsed.rejected;
    format = "csv";
    // A file with no usable header row is more likely a pasted list than a
    // broken CSV, so give the lenient reader the last word before failing.
    if (entries.length === 0) {
      const fallback = entriesFromLines(body);
      if (fallback.entries.length > 0) {
        entries = fallback.entries;
        rejected = fallback.rejected;
        format = "ids";
      }
    }
  }

  if (entries.length === 0) {
    throw new Error(
      `No tweets found${rejected > 0 ? ` (${rejected} row${rejected === 1 ? "" : "s"} unreadable)` : ""} — expected a CSV with a tweet ID or URL column, JSON tweet objects, or one status link per line.`,
    );
  }
  return {
    fileName,
    importedAt: Date.now(),
    format,
    entries,
    rejected,
  };
}

/**
 * Fit the import into device storage without losing what makes it playable.
 *
 * `raw` is the fat field — a 2 MB JSON archive would otherwise be persisted
 * whole into localStorage and fail the write at random points on Android
 * WebView, where the quota is per-origin and shared. Stripping is ordered by
 * what hurts least: `raw` goes first (its media is salvaged into `mediaUrls`
 * so the lane still plays), then the copied text, which the API re-supplies on
 * hydration and which is the least load-bearing thing on a slide.
 */
export function shrinkImport(
  imported: BookmarkImport,
  budgetBytes: number,
): { import: BookmarkImport; shrunk: boolean } {
  const size = (value: BookmarkImport) => JSON.stringify(value).length;
  if (size(imported) <= budgetBytes) return { import: imported, shrunk: false };

  const withoutRaw: BookmarkEntry[] = imported.entries.map((entry) => {
    if (!entry.raw) return entry;
    const salvaged = mediaUrlsOfTweet(entry.raw);
    const { raw: _raw, ...rest } = entry;
    return salvaged.length > 0 ? { ...rest, mediaUrls: salvaged } : rest;
  });
  const step2: BookmarkImport = { ...imported, entries: withoutRaw };
  if (size(step2) <= budgetBytes) return { import: step2, shrunk: true };

  const withoutText: BookmarkEntry[] = withoutRaw.map(({ title: _title, ...rest }) => rest);
  // Truncating the entry list is the last resort, and the caller says so out
  // loud rather than leaving a file that quietly imported "less". The loop
  // shrinks by a quarter each pass and stops on its own: `Math.max(1, …)` would
  // otherwise pin the length at 1 and never satisfy a budget that small.
  let kept = withoutText;
  while (kept.length > 1 && size({ ...imported, entries: kept }) > budgetBytes) {
    kept = kept.slice(0, Math.floor((kept.length * 3) / 4));
  }
  return { import: { ...imported, entries: kept }, shrunk: true };
}

const VIDEO_EXT = /\.(mp4|m4v|mov|webm)(\?|$)/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i;

/**
 * A slide out of the file alone, when the file described one.
 *
 * This is the whole reason a JSON export needs no token: the tweet is already
 * there, media variants and all, so it goes through `parseTweet` exactly like an
 * API response. Without `raw` the media URLs are the next best thing — the
 * player's own unplayable policy (skip the slide, keep the deck) covers the case
 * where a URL X handed out has since gone cold, which is why an unknown
 * extension is allowed through as video instead of being dropped for being
 * unverifiable.
 */
export function postFromEntry(entry: BookmarkEntry): FlickPost | null {
  if (entry.raw) {
    const parsed = parseTweet(entry.raw, { account: entry.account });
    if (parsed) return parsed;
  }
  const urls = entry.mediaUrls ?? [];
  if (urls.length === 0) return null;
  const videoUrl =
    urls.find((url) => VIDEO_EXT.test(url)) ?? urls.find((url) => !IMAGE_EXT.test(url));
  const imageUrl = urls.find((url) => IMAGE_EXT.test(url));
  const title = entry.title?.trim() || `X bookmark ${entry.id}`;
  // Same rule the parser applies to live tweets, applied to text this file
  // brought in on its own.
  if (isUnsafeMinorContent(title, entry.account)) return null;

  // A media-only row has no tweet page to point at, and inventing one would
  // send the "open" button to a 404 on x.com. The file is the source here.
  const permalink =
    entry.url ??
    (entry.synthetic ? (entry.mediaUrls?.[0] ?? "") : `https://x.com/i/status/${entry.id}`);
  const base = {
    id: `x_${entry.id}`,
    name: entry.account ? `x:${entry.account}` : `x:${entry.id}`,
    title,
    author: entry.account ?? "",
    // Kept empty on purpose: the mixer, the badge and the filter all branch on
    // `origin`, and a tweet has no subreddit to name.
    subreddit: "",
    permalink,
    // An export carries no rating of its own, and nothing here can infer one —
    // claiming `false` is the honest default because the slide only uses it to
    // label, never to hide.
    nsfw: false,
    createdUtc: entry.createdAt ?? 0,
    score: 0,
    origin: "twitter" as const,
    account: entry.account,
  };
  if (videoUrl) {
    const video: FlickVideo = { url: videoUrl, width: 720, height: 1280, hasAudio: true };
    return { ...base, kind: "video", video };
  }
  if (imageUrl) return { ...base, kind: "image", image: { url: imageUrl } };
  return null;
}

/** Ids that need X to say what they are, newest-first as the file listed them. */
export function entriesNeedingHydration(entries: BookmarkEntry[]): BookmarkEntry[] {
  return entries.filter((entry) => postFromEntry(entry) === null);
}
