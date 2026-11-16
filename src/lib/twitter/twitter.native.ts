import { Capacitor, CapacitorHttp } from "@capacitor/core";
import {
  GQL_FEATURES,
  X_WEB_BEARER,
  X_WEB_UA,
  invalidateQueryIdsCache,
  resolveQueryIds,
  type TwitterOperation,
} from "./graphql";
import { fetchViaTwitterWebView } from "./native-auth";
import {
  parseBookmarksTimeline,
  parseTweetDetailComments,
  parseUserMediaTimeline,
} from "./parse";
import type { TwitterPage, TwitterSession } from "./types";
import type { RedditComment } from "@/lib/reddit/types";

function parseJson(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object") return data as Record<string, unknown>;
  if (typeof data === "string" && data.trim()) {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function buildHeaders(session: TwitterSession, isPost = false): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${X_WEB_BEARER}`,
    "x-csrf-token": session.ct0,
    Cookie: `auth_token=${session.authToken}; ct0=${session.ct0}`,
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-active-user": "yes",
    "x-twitter-client-language": "en",
    "User-Agent": X_WEB_UA,
    Referer: "https://x.com/i/bookmarks",
  };
  if (isPost) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

async function gqlRequest(
  session: TwitterSession,
  operation: TwitterOperation,
  options: {
    method?: "GET" | "POST";
    variables: Record<string, unknown>;
    includeFeatures?: boolean;
  },
  retried = false,
): Promise<Record<string, unknown>> {
  const method = options.method ?? "GET";
  const qids = await resolveQueryIds(retried);
  const queryId = qids[operation];

  let url = `https://x.com/i/api/graphql/${queryId}/${operation}`;
  let bodyStr: string | undefined;

  if (method === "GET") {
    const sp = new URLSearchParams();
    sp.set("variables", JSON.stringify(options.variables));
    if (options.includeFeatures !== false) {
      sp.set("features", JSON.stringify(GQL_FEATURES));
    }
    url = `${url}?${sp.toString()}`;
  } else {
    bodyStr = JSON.stringify({
      variables: options.variables,
      queryId,
    });
  }

  const headers = buildHeaders(session, method === "POST");

  const res = await CapacitorHttp.request({
    url,
    method,
    headers,
    data: bodyStr,
  });

  if ((res.status === 404 || res.status === 403) && !retried) {
    invalidateQueryIdsCache();
    return gqlRequest(session, operation, options, true);
  }

  if ((res.status === 404 || res.status === 403) && Capacitor.isNativePlatform()) {
    const wv = await fetchViaTwitterWebView({
      url,
      method,
      headers,
      body: bodyStr,
    });
    if (wv.status >= 200 && wv.status < 300) {
      return parseJson(wv.body);
    }
    if (wv.status === 401) {
      throw new Error("X session expired — sign in to X again.");
    }
    throw new Error(`X request failed (${wv.status || res.status}).`);
  }

  if (res.status === 401) {
    throw new Error("X session expired — sign in to X again.");
  }

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`X request failed (${res.status}).`);
  }

  return parseJson(res.data);
}

export async function fetchTwitterBookmarksPage(
  session: TwitterSession,
  cursor?: string | null,
  count = 40,
): Promise<TwitterPage> {
  const variables: Record<string, unknown> = {
    count,
    includePromotedContent: false,
  };
  if (cursor) variables.cursor = cursor;

  const json = await gqlRequest(session, "Bookmarks", {
    method: "GET",
    variables,
    includeFeatures: true,
  });
  const parsed = parseBookmarksTimeline(json);
  return {
    posts: parsed.posts,
    cursor: parsed.cursor,
    username: session.username,
  };
}

export async function fetchTwitterUserMedia(
  session: TwitterSession,
  screenName: string,
  count = 40,
): Promise<TwitterPage> {
  const clean = screenName.replace(/^@/, "").trim();
  const userJson = await gqlRequest(session, "UserByScreenName", {
    method: "GET",
    variables: { screen_name: clean, withSafetyModeUserFields: true },
    includeFeatures: true,
  });
  const userRes = (userJson.data as Record<string, unknown> | undefined)?.user as
    | Record<string, unknown>
    | undefined;
  const restId = (userRes?.result as Record<string, unknown> | undefined)?.rest_id;
  if (typeof restId !== "string" || !restId) {
    throw new Error(`Could not find X user @${clean}.`);
  }

  const mediaJson = await gqlRequest(session, "UserMedia", {
    method: "GET",
    variables: {
      userId: restId,
      count,
      includePromotedContent: false,
      withClientEventToken: false,
      withBirdwatchNotes: false,
      withVoice: true,
      withV2Timeline: true,
    },
    includeFeatures: true,
  });
  const parsed = parseUserMediaTimeline(mediaJson);
  return {
    posts: parsed.posts,
    cursor: parsed.cursor,
    username: clean,
  };
}

export async function fetchTwitterTweetComments(
  session: TwitterSession,
  tweetId: string,
): Promise<RedditComment[]> {
  const json = await gqlRequest(session, "TweetDetail", {
    method: "GET",
    variables: {
      focalTweetId: tweetId,
      with_rux_injections: false,
      rankingMode: "Relevance",
      includePromotedContent: false,
      withCommunity: true,
      withQuickPromoteEligibilityTweetFields: true,
      withBirdwatchNotes: true,
      withVoice: true,
    },
    includeFeatures: true,
  });
  return parseTweetDetailComments(json, tweetId);
}

export async function createTwitterBookmark(
  session: TwitterSession,
  tweetId: string,
): Promise<void> {
  await gqlRequest(session, "CreateBookmark", {
    method: "POST",
    variables: { tweet_id: tweetId },
    includeFeatures: false,
  });
}

export async function deleteTwitterBookmark(
  session: TwitterSession,
  tweetId: string,
): Promise<void> {
  await gqlRequest(session, "DeleteBookmark", {
    method: "POST",
    variables: { tweet_id: tweetId },
    includeFeatures: false,
  });
}
