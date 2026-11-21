import { Capacitor } from "@capacitor/core";
import {
  nativeExchangeCode,
  nativeFetchComments,
  nativeFetchDemoFeed,
  nativeFetchSavedPage,
  nativeFetchSubredditFeed,
  nativeFetchUserFeed,
  nativeRefreshGrant,
  nativeResolveRedgifsClip,
  nativeSavePost,
  nativeSearchSubreddits,
  nativeUnsavePost,
} from "./reddit.native";
import type { FlickPost, RedditComment, SavedPage, SubredditInfo, SubredditSort } from "./types";
import type { RedgifsClip, TokenBundle } from "./reddit.native";

function native(): boolean {
  return Capacitor.isNativePlatform();
}

export async function callExchangeCode(input: {
  code: string;
  redirectUri: string;
  clientId: string;
}): Promise<TokenBundle> {
  if (native()) {
    return nativeExchangeCode({
      code: input.code,
      redirectUri: input.redirectUri,
      clientId: input.clientId.trim(),
    });
  }
  const { redditExchangeCode } = await import("./functions");
  return redditExchangeCode({ data: input });
}

export async function callRefreshGrant(input: {
  refreshToken: string;
  clientId: string;
}): Promise<TokenBundle> {
  if (native()) {
    return nativeRefreshGrant({
      refreshToken: input.refreshToken,
      clientId: input.clientId.trim(),
    });
  }
  const { redditRefresh } = await import("./functions");
  return redditRefresh({ data: input });
}

export async function callSavedPage(input: {
  accessToken: string;
  username: string;
  after?: string | null;
}): Promise<SavedPage> {
  if (native()) {
    return nativeFetchSavedPage(input);
  }
  const { redditSavedPage } = await import("./functions");
  return redditSavedPage({ data: input });
}

export async function callDemoFeed(subreddits?: string[], accessToken?: string): Promise<FlickPost[]> {
  if (native()) {
    return nativeFetchDemoFeed(subreddits, accessToken);
  }
  const { redditDemoFeed } = await import("./functions");
  return redditDemoFeed({ data: { subreddits } });
}

export async function callSubredditFeed(input: {
  subreddit: string;
  sort?: SubredditSort;
  accessToken?: string;
}): Promise<FlickPost[]> {
  if (native()) {
    return nativeFetchSubredditFeed(input);
  }
  const { redditSubredditFeed } = await import("./functions");
  return redditSubredditFeed({ data: input });
}

export async function callUserFeed(input: {
  username: string;
  accessToken?: string;
}): Promise<FlickPost[]> {
  return nativeFetchUserFeed(input);
}

export async function callSearchSubreddits(input: {
  query: string;
  accessToken?: string;
}): Promise<SubredditInfo[]> {
  if (native()) {
    return nativeSearchSubreddits(input);
  }
  const { redditSearchSubreddits } = await import("./functions");
  return redditSearchSubreddits({ data: input });
}

export async function callPostComments(input: {
  subreddit: string;
  postId: string;
  accessToken?: string;
}): Promise<RedditComment[]> {
  if (native()) {
    return nativeFetchComments(input);
  }
  const { redditComments } = await import("./functions");
  return redditComments({ data: input });
}

export async function callUnsavePost(input: {
  accessToken: string;
  fullname: string;
}): Promise<void> {
  if (native()) {
    return nativeUnsavePost(input);
  }
  const { redditUnsave } = await import("./functions");
  return redditUnsave({ data: input });
}

export async function callSavePost(input: {
  accessToken: string;
  fullname: string;
}): Promise<void> {
  if (native()) {
    return nativeSavePost(input);
  }
  const { redditSave } = await import("./functions");
  return redditSave({ data: input });
}

export async function callRedgifsClip(input: {
  id: string;
  fresh?: boolean;
}): Promise<RedgifsClip | null> {
  if (native()) {
    return nativeResolveRedgifsClip(input.id, { fresh: input.fresh });
  }
  const { redgifsClip } = await import("./functions");
  return redgifsClip({ data: input });
}
