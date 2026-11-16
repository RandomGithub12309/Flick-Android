import { CapacitorHttp } from "@capacitor/core";

/** Public X web-client bearer token used by x.com in the browser. */
export const X_WEB_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

export const X_WEB_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

export type TwitterOperation =
  | "Bookmarks"
  | "CreateBookmark"
  | "DeleteBookmark"
  | "TweetDetail"
  | "UserByScreenName"
  | "UserMedia";

const FALLBACK_QUERY_IDS: Record<TwitterOperation, string> = {
  Bookmarks: "qadf2-2f0fW12e3d0n0B8w",
  CreateBookmark: "aoDbu3RHznuiSkQ9aNM67Q",
  DeleteBookmark: "Wlmlj2-xzyS1GN3a6cj-mQ",
  TweetDetail: "nBS-WpgA6ZG0CyNHD517JQ",
  UserByScreenName: "xmU6X_CKVnQ5lSrCbAmJsg",
  UserMedia: "MOLbHntMePjsc9kLTaGrLA",
};

export const GQL_FEATURES: Record<string, boolean> = {
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  responsive_web_media_download_video_enabled: true,
};

const CACHE_KEY = "flick.x.qids.v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CachedQids = {
  ts: number;
  ids: Partial<Record<TwitterOperation, string>>;
};

function readCachedQids(): CachedQids | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(CACHE_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedQids;
    if (!parsed || typeof parsed.ts !== "number" || !parsed.ids) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedQids(ids: Partial<Record<TwitterOperation, string>>) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), ids }));
  } catch {
    // Ignore quota errors
  }
}

export function invalidateQueryIdsCache() {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // Ignore
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await CapacitorHttp.request({
    url,
    method: "GET",
    headers: { "User-Agent": X_WEB_UA },
  });
  if (res.status < 200 || res.status >= 300) return "";
  return typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? "");
}

let refreshPromise: Promise<Partial<Record<TwitterOperation, string>>> | null = null;

/**
 * Scans x.com's live web JS bundles for current GraphQL queryId hashes so
 * rotating X web builds do not permanently break bookmark syncing.
 */
export async function resolveQueryIds(forceRefresh = false): Promise<Record<TwitterOperation, string>> {
  const cached = !forceRefresh ? readCachedQids() : null;
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS && cached.ids.Bookmarks) {
    return { ...FALLBACK_QUERY_IDS, ...cached.ids };
  }

  if (!refreshPromise) {
    refreshPromise = (async () => {
      const found: Partial<Record<TwitterOperation, string>> = {};
      try {
        const html = await fetchText("https://x.com/i/bookmarks");
        const bundleUrls = Array.from(
          html.matchAll(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web[^"'\s]+\.js/g),
          (m) => m[0],
        ).slice(0, 8);

        const targetOps = new Set<string>(Object.keys(FALLBACK_QUERY_IDS));
        const opRegex = /queryId:"([A-Za-z0-9_-]+)",operationName:"([A-Za-z0-9_]+)"/g;

        await Promise.all(
          bundleUrls.map(async (jsUrl) => {
            const js = await fetchText(jsUrl).catch(() => "");
            if (!js) return;
            for (const match of js.matchAll(opRegex)) {
              const qid = match[1];
              const op = match[2];
              if (qid && op && targetOps.has(op)) {
                found[op as TwitterOperation] = qid;
              }
            }
          }),
        );

        if (Object.keys(found).length > 0) {
          writeCachedQids(found);
        }
      } catch {
        // Fall back to defaults on offline/network errors
      } finally {
        refreshPromise = null;
      }
      return found;
    })();
  }

  const discovered = await refreshPromise;
  return { ...FALLBACK_QUERY_IDS, ...(cached?.ids ?? {}), ...discovered };
}
