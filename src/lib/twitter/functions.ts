import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MAX_IDS_PER_CALL } from "./x.server";

/**
 * Server boundary for the X lane, mirroring `@/lib/reddit/functions`.
 *
 * What crosses it is a list of tweet ids and, optionally, a Bearer token. The
 * ids are of public posts — the private part of this feature (which tweets the
 * person bookmarked) never leaves their device, which is the entire point of
 * taking a file instead of calling a bookmarks endpoint. The token is a
 * credential: it goes to Flick's own server and nowhere else, nothing here
 * echoes it back, and no handler logs it.
 */

/** X's own id grammar. Anything looser is a malformed import, not a lookup. */
const tweetId = z
  .string()
  .trim()
  .regex(/^\d{1,25}$/, "Not a tweet id");

export const twitterHydrate = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ids: z
        .array(tweetId)
        .min(1, "No tweet ids to look up.")
        .max(MAX_IDS_PER_CALL, "That is too many ids for one lookup."),
      bearerToken: z.string().max(4096, "That does not look like a Bearer token.").optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { hydrateTweetIds } = await import("./x.server");
    return hydrateTweetIds({ ids: data.ids, bearerToken: data.bearerToken });
  });

/**
 * What this deployment can do before anyone pastes a token, so the settings
 * screen can say "lookups already work here" instead of asking for a key that
 * would be ignored.
 */
export const twitterStatus = createServerFn({ method: "POST" }).handler(async () => {
  const { hasServerBearerToken } = await import("./x.server");
  return hasServerBearerToken();
});
