import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Server boundary for the X lane, mirroring `@/lib/reddit/functions`.
 *
 * A Bearer token is a credential, so it travels to Flick's own server and no
 * further; nothing here echoes it back, and the feed handler never logs it.
 */

const handle = z
  .string()
  .trim()
  .min(1, "Add an X account to pull from.")
  .max(64, "That is not an X handle.");

const token = z.string().max(4096, "That does not look like a Bearer token.").optional();

export const twitterFeed = createServerFn({ method: "POST" })
  .validator(
    z.object({
      handle,
      bearerToken: token,
      after: z.string().max(512).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { fetchTwitterFeed } = await import("./x.server");
    return fetchTwitterFeed({
      handle: data.handle,
      bearerToken: data.bearerToken,
      after: data.after ?? null,
    });
  });

/**
 * What the deployment can do before anyone types a token in, so the connect
 * screen can say "this Flick already has API access" instead of asking for a
 * key that would be ignored.
 */
export const twitterStatus = createServerFn({ method: "POST" }).handler(async () => {
  const { hasServerBearerToken } = await import("./x.server");
  return hasServerBearerToken();
});
