/**
 * Content Flick must not surface, whatever host it arrives from.
 *
 * Flick is an 18+ player that shows NSFW and blurs nothing, so this is the one
 * filter the feed applies — and it belongs here rather than in the Reddit
 * parser, because a lane that skips the check is a hole, not a second
 * implementation. Every host's parser calls it before returning a post.
 */

const MINOR_PATTERN =
  /\b(loli|shota|child porn|preteen|pre-teen|underage|under.?18|jailbait)\b/i;

/**
 * True when any field reads as a request for child sexual abuse material.
 *
 * The pattern is deliberately narrow: these are phrases that identify the
 * content rather than words an ordinary post might happen to contain, so the
 * check runs on the free text the host supplies (title, body, community, handle)
 * and nothing is inferred from tags or user reports. A hit drops the post from
 * the deck — no warning, no play button.
 */
export function isUnsafeMinorContent(...fields: Array<string | undefined>): boolean {
  return fields.some((field) => typeof field === "string" && MINOR_PATTERN.test(field));
}
