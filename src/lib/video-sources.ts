import type { FlickVideo } from "@/lib/reddit/types";

/**
 * Every audio URL a Reddit-hosted video might be served under, most likely
 * first. Reddit uploads split video and audio, and has renamed the audio file
 * more than once, so a single guessed name is a coin flip — carrying the whole
 * list is what keeps the fallback audible.
 */
export function audioCandidatesFor(
  video: Pick<FlickVideo, "audioUrl" | "audioUrls"> | undefined,
): string[] | undefined {
  if (!video) return undefined;
  const list = video.audioUrls?.length ? video.audioUrls : video.audioUrl ? [video.audioUrl] : [];
  return list.length > 0 ? list : undefined;
}

/**
 * The files a post can be played from, best first: the real clip, then the
 * host's own copy for networks where the primary CDN is unreachable.
 */
export function videoSources(video: Pick<FlickVideo, "fallbackUrl" | "url">): string[] {
  const list = [video.url, video.fallbackUrl].filter((url): url is string => Boolean(url));
  return [...new Set(list)];
}

/**
 * The audio candidates that belong to the source currently on screen.
 *
 * Audio has to follow the *source*, not the post. A redgifs clip carries its
 * sound inside the mp4, so pairing it with a separate audio track would play
 * the same clip twice at once; that track belongs to `fallbackUrl` and is only
 * wanted once the player has actually fallen back to it. Conversely, the
 * fallback is usually a video-only Reddit upload, so without its sidecar it
 * plays silently — which is the one case the fallback is there to prevent.
 */
export function audioUrlsForSource(
  video: Pick<FlickVideo, "audioUrl" | "audioUrls" | "fallbackAudioUrls">,
  isFallback: boolean,
): string[] {
  const list = isFallback
    ? (video.fallbackAudioUrls ?? [])
    : video.audioUrls?.length
      ? video.audioUrls
      : video.audioUrl
        ? [video.audioUrl]
        : [];
  return [...new Set(list)];
}
