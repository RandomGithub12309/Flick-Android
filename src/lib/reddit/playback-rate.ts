/**
 * Playback-speed mapping for the draggable speed bar.
 *
 * Kept separate from the store (which pulls in zustand and `@/`-aliased
 * modules) so the mapping is unit-testable with the plain node test runner.
 */

/** Range the speed bar scrubs between. Below 0.25 is unreadable; 3 is plenty. */
export const MIN_PLAYBACK_RATE = 0.25;
export const MAX_PLAYBACK_RATE = 3;

const RATE_SPAN = Math.log(MAX_PLAYBACK_RATE / MIN_PLAYBACK_RATE);

/**
 * Bar position (0-1) -> playback rate, exponentially rather than linearly.
 *
 * Linear would give the 0.25x-1x range — the interesting half — barely a third
 * of the travel and park 1x almost at the far left. This puts 1x at ~56% and
 * keeps fine control where people actually scrub.
 */
export function playbackRateFromRatio(ratio: number): number {
  const t = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  return MIN_PLAYBACK_RATE * Math.exp(RATE_SPAN * t);
}

/** Inverse of {@link playbackRateFromRatio} — where to draw the handle. */
export function ratioFromPlaybackRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  const r = Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, rate));
  return Math.log(r / MIN_PLAYBACK_RATE) / RATE_SPAN;
}

export function clampPlaybackRate(rate: number): number {
  // NaN has no meaningful side of the range, so fall back to normal speed.
  // ±Infinity is genuinely out of bounds and clamps like any other overshoot.
  if (Number.isNaN(rate)) return 1;
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, rate));
}
