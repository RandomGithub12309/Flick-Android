import { twMerge } from "tailwind-merge";

export function cn(
  ...parts: Array<string | false | null | undefined>
): string {
  return twMerge(...parts.filter((p): p is string => Boolean(p)));
}

export function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const current = items[i];
    const swap = items[j];
    if (current === undefined || swap === undefined) continue;
    items[i] = swap;
    items[j] = current;
  }
  return items;
}

export function formatScore(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** `m:ss`, or `h:mm:ss` past the hour. Unknown or negative reads as `0:00`. */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Width ÷ height, or null when either side isn't a usable size. */
export function mediaRatio(width?: number, height?: number): number | null {
  if (
    width == null ||
    height == null ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return width / height;
}

/**
 * Wider than tall. Slack keeps near-square frames from flipping into
 * letterboxing over a 1px measurement error.
 */
export function isLandscapeRatio(ratio: number | null): boolean {
  return ratio != null && ratio > 1.02;
}

export type ContainRect = {
  width: number;
  height: number;
  left: number;
  top: number;
};

/**
 * Largest rectangle of `mediaW`×`mediaH` that fits inside `frameW`×`frameH`
 * without cropping. Used so landscape video on a portrait screen is letterboxed
 * instead of sliced into a centre strip.
 */
export function containRect(
  frameW: number,
  frameH: number,
  mediaW: number,
  mediaH: number,
): ContainRect {
  if (frameW <= 0 || frameH <= 0 || mediaW <= 0 || mediaH <= 0) {
    return { width: Math.max(0, frameW), height: Math.max(0, frameH), left: 0, top: 0 };
  }
  const scale = Math.min(frameW / mediaW, frameH / mediaH);
  const width = mediaW * scale;
  const height = mediaH * scale;
  return {
    width,
    height,
    left: (frameW - width) / 2,
    top: (frameH - height) / 2,
  };
}
