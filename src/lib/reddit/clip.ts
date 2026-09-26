import { redgifsClip } from "@/lib/reddit/functions";
import type { FlickVideo } from "@/lib/reddit/types";

/**
 * Client-side lookups of a single redgifs clip.
 *
 * The feed resolves clips while loading, but a resolved URL can still fail
 * once a slide is actually played: redgifs signs some CDN links with an expiry
 * stamp, clips get pulled, and the lookup itself can fail transiently on a
 * cold server. Asking again is the difference between a video that plays and
 * one the feed skips.
 */

const inFlight = new Map<string, Promise<FlickVideo | null>>();

export function requestRedgifsClip(
  id: string,
  options: { fresh?: boolean } = {},
): Promise<FlickVideo | null> {
  const key = `${options.fresh ? "fresh" : "cached"}:${id}`;
  // Several slides can want the same clip at once (a repost, a re-activation);
  // one request answers all of them.
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = redgifsClip({ data: { id, fresh: options.fresh ?? false } })
    .then((clip): FlickVideo | null =>
      clip
        ? {
            // Redgifs muxes the sound into the mp4, so there is no sidecar.
            url: clip.url,
            width: clip.width ?? 720,
            height: clip.height ?? 1280,
            duration: clip.duration,
            hasAudio: clip.hasAudio,
          }
        : null,
    )
    .catch(() => null)
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}
