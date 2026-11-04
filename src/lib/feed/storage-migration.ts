/**
 * Cleaning up what an older version of this app left in device storage.
 *
 * zustand's `persist` shallow-merges whatever is in storage over the initial
 * state, so a key the code no longer defines is still restored — and the
 * bookmarks import behind that key was capped at 1.2 MB per device. Deleting the
 * code that reads it does not delete the blob, so the migration drops it on the
 * way in, before the merge.
 */

/** Keys an earlier app version persisted that no code reads any more. */
const REMOVED_KEYS = ["twitter", "includeTwitter", "includeReddit", "twitterShare"] as const;

export function purgeRemovedLanes(persisted: unknown): Record<string, unknown> {
  if (!persisted || typeof persisted !== "object" || Array.isArray(persisted)) return {};
  const rest: Record<string, unknown> = { ...(persisted as Record<string, unknown>) };
  for (const key of REMOVED_KEYS) delete rest[key];
  return rest;
}
