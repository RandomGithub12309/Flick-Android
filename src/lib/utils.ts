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
