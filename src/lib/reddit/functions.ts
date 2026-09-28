import { Capacitor } from "@capacitor/core";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  nativeDemoFeed,
  nativeExchangeCode,
  nativeRedgifsClip,
  nativeRefresh,
  nativeSavedPage,
} from "./native-api";

/**
 * Flick's backend, with two interchangeable implementations.
 *
 * On the web these are server functions running on Vercel. In the packaged
 * Android app there is no deployment to call, so the same operations run on the
 * device (`native-api.ts`) — the requests are the same stateless calls the
 * server was making, and none of them carries a secret. The switch is made
 * here so every call site keeps importing these names and never learns which
 * one it is talking to.
 *
 * The zod validators are shared by both paths on purpose: the same bad input
 * has to fail the same way on a phone and in a browser.
 */

const creds = z.object({
  clientId: z.string().min(2),
});

const exchangeInput = creds.extend({
  code: z.string().min(1),
  redirectUri: z.string().url(),
});

const refreshInput = creds.extend({
  refreshToken: z.string().min(1),
});

const savedInput = z.object({
  accessToken: z.string().min(8),
  username: z.string().min(1),
  after: z.string().nullable().optional(),
});

/**
 * The id is validated to the shape redgifs actually issues, since this is a
 * public endpoint in front of a third-party API.
 */
const redgifsInput = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9]{4,64}$/i),
  fresh: z.boolean().optional(),
});

const exchangeCodeServer = createServerFn({ method: "POST" })
  .validator(exchangeInput)
  .handler(async ({ data }) => {
    const { exchangeCode } = await import("./reddit.server");
    return exchangeCode({
      code: data.code,
      redirectUri: data.redirectUri,
      clientId: data.clientId.trim(),
    });
  });

const refreshServer = createServerFn({ method: "POST" })
  .validator(refreshInput)
  .handler(async ({ data }) => {
    const { refreshGrant } = await import("./reddit.server");
    return refreshGrant({
      refreshToken: data.refreshToken,
      clientId: data.clientId.trim(),
    });
  });

const savedPageServer = createServerFn({ method: "POST" })
  .validator(savedInput)
  .handler(async ({ data }) => {
    const { fetchSavedPage } = await import("./reddit.server");
    return fetchSavedPage({
      accessToken: data.accessToken,
      username: data.username,
      after: data.after,
    });
  });

const demoFeedServer = createServerFn({ method: "POST" }).handler(async () => {
  const { fetchDemoFeed } = await import("./reddit.server");
  return fetchDemoFeed();
});

/**
 * One-shot lookup of a redgifs clip, used when a slide has no playable file
 * (the feed-level lookup failed, or the post is a bare link) or when playback
 * of a resolved clip fails on the device — `fresh` skips the cache, because
 * the URL that just failed is exactly the one a cached answer returns.
 */
const redgifsClipServer = createServerFn({ method: "POST" })
  .validator(redgifsInput)
  .handler(async ({ data }) => {
    const { resolveRedgifsClip } = await import("./reddit.server");
    return resolveRedgifsClip(data.id, { fresh: data.fresh });
  });

/** True when packaged in the Android app, where there is no server to call. */
function onDevice(): boolean {
  return Capacitor.isNativePlatform();
}

export function redditExchangeCode(opts: { data: unknown }) {
  const data = exchangeInput.parse(opts.data);
  if (onDevice()) {
    return nativeExchangeCode({
      code: data.code,
      redirectUri: data.redirectUri,
      clientId: data.clientId.trim(),
    });
  }
  return exchangeCodeServer({ data: { ...data, clientId: data.clientId.trim() } });
}

export function redditRefresh(opts: { data: unknown }) {
  const data = refreshInput.parse(opts.data);
  if (onDevice()) {
    return nativeRefresh({
      refreshToken: data.refreshToken,
      clientId: data.clientId.trim(),
    });
  }
  return refreshServer({ data: { ...data, clientId: data.clientId.trim() } });
}

export function redditSavedPage(opts: { data: unknown }) {
  const data = savedInput.parse(opts.data);
  if (onDevice()) {
    return nativeSavedPage({
      accessToken: data.accessToken,
      username: data.username,
      after: data.after ?? null,
    });
  }
  return savedPageServer({ data });
}

export function redditDemoFeed() {
  if (onDevice()) return nativeDemoFeed();
  return demoFeedServer();
}

export function redgifsClip(opts: { data: unknown }) {
  const data = redgifsInput.parse(opts.data);
  if (onDevice()) return nativeRedgifsClip({ id: data.id, fresh: data.fresh });
  return redgifsClipServer({ data });
}
