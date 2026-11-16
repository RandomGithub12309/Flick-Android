import { Capacitor } from "@capacitor/core";
import {
  nativeExchangeCode,
  nativeFetchDemoFeed,
  nativeFetchSavedPage,
  nativeRefreshGrant,
  nativeResolveRedgifsClip,
  nativeUnsavePost,
} from "./reddit.native";
import type { FlickPost, SavedPage } from "./types";
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

export async function callDemoFeed(subreddits?: string[]): Promise<FlickPost[]> {
  if (native()) {
    return nativeFetchDemoFeed(subreddits);
  }
  const { redditDemoFeed } = await import("./functions");
  return redditDemoFeed({ data: { subreddits } });
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
