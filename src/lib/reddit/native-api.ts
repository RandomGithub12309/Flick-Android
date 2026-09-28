import {
  exchangeCode,
  fetchDemoFeed,
  fetchSavedPage,
  refreshGrant,
  resolveRedgifsClip,
  type RedgifsClip,
  type TokenBundle,
} from "./reddit-api";
import type { FlickPost, SavedPage } from "./types";

/**
 * The device-side half of Flick's backend.
 *
 * The packaged Android app has no Vercel deployment behind it, so every server
 * function runs here instead. That is only possible because none of them hold
 * anything a server would: no session, no database, no client secret (Reddit
 * issues an installed app with no secret, and `basicAuth` sends the client id
 * with an empty password). What the device *can't* do unaided is reach Reddit
 * from a WebView — those hosts send no CORS headers — so every call goes
 * through `httpJson`, which uses Capacitor's native HTTP plugin there.
 *
 * The one behavioural difference from the web app is playback: with no proxy
 * origin to hand to `<video>`, resolved redgifs clips carry the CDN link itself
 * and `RedgifsWebViewClient` re-issues the request natively with the headers
 * the CDN demands. See `ClipPlayback`.
 */

/** Clip playback on a device: the CDN link, replayed by the native WebView client. */
const PLAYBACK = "direct" as const;

export function nativeExchangeCode(input: {
  code: string;
  redirectUri: string;
  clientId: string;
}): Promise<TokenBundle> {
  return exchangeCode(input);
}

export function nativeRefresh(input: {
  refreshToken: string;
  clientId: string;
}): Promise<TokenBundle> {
  return refreshGrant(input);
}

export function nativeSavedPage(input: {
  accessToken: string;
  username: string;
  after: string | null;
}): Promise<SavedPage> {
  return fetchSavedPage({ ...input, playback: PLAYBACK });
}

export function nativeDemoFeed(): Promise<FlickPost[]> {
  return fetchDemoFeed(PLAYBACK);
}

export function nativeRedgifsClip(input: {
  id: string;
  fresh?: boolean;
}): Promise<RedgifsClip | null> {
  return resolveRedgifsClip(input.id, { fresh: input.fresh, playback: PLAYBACK });
}
