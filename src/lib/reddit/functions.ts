import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const creds = z.object({
  clientId: z.string().min(2),
});

export const redditExchangeCode = createServerFn({ method: "POST" })
  .validator(
    creds.extend({
      code: z.string().min(1),
      redirectUri: z.string().url(),
    }),
  )
  .handler(async ({ data }) => {
    const { exchangeCode } = await import("./reddit.server");
    return exchangeCode({
      code: data.code,
      redirectUri: data.redirectUri,
      clientId: data.clientId.trim(),
    });
  });

export const redditRefresh = createServerFn({ method: "POST" })
  .validator(
    creds.extend({
      refreshToken: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { refreshGrant } = await import("./reddit.server");
    return refreshGrant({
      refreshToken: data.refreshToken,
      clientId: data.clientId.trim(),
    });
  });

export const redditSavedPage = createServerFn({ method: "POST" })
  .validator(
    z.object({
      accessToken: z.string().min(8),
      username: z.string().min(1),
      after: z.string().nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { fetchSavedPage } = await import("./reddit.server");
    return fetchSavedPage({
      accessToken: data.accessToken,
      username: data.username,
      after: data.after,
    });
  });

export const redditDemoFeed = createServerFn({ method: "POST" }).handler(async () => {
  const { fetchDemoFeed } = await import("./reddit.server");
  return fetchDemoFeed();
});
