export type VideoFailureReason = "error" | "start-timeout";

type VideoPlaybackState = Pick<HTMLMediaElement, "paused" | "ended">;

type ShouldSkipDeadVideoOptions = {
  active: boolean;
  blocked: boolean;
  reported: boolean;
  video: Pick<HTMLMediaElement, "paused" | "ended" | "currentTime"> | null;
  reason: VideoFailureReason;
};

/** Return whether the media element is in its active playback state. */
export function isVideoPlaying(video: VideoPlaybackState | null): boolean {
  return video !== null && !video.paused && !video.ended;
}

/**
 * Usable timeline length for progress and seeking. Fragmented uploads
 * (v.redd.it DASH/CMAF) regularly report `duration` as Infinity or NaN while
 * still exposing a perfectly seekable range — so fall back to the end of the
 * seekable window before giving up and calling the length unknown (0).
 */
export function effectiveDuration(duration: number, seekableEnd: number | null): number {
  if (Number.isFinite(duration) && duration > 0) return duration;
  if (seekableEnd != null && Number.isFinite(seekableEnd) && seekableEnd > 0) {
    return seekableEnd;
  }
  return 0;
}

/**
 * Decide whether a player failure should cause the feed to skip this post.
 * Preloaded/offscreen and tap-to-play videos are never treated as dead. A
 * start timeout is also inconclusive after playback has made progress, while
 * a hard media error can still identify a frozen clip.
 */
export function shouldSkipDeadVideo({
  active,
  blocked,
  reported,
  video,
  reason,
}: ShouldSkipDeadVideoOptions): boolean {
  if (!active || blocked || reported || isVideoPlaying(video) || !video) return false;
  if (reason === "start-timeout" && video.currentTime > 0.1) return false;
  return true;
}
