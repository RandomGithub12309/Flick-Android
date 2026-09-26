import { useCallback, useRef, useState } from "react";
import { formatTime } from "@/lib/utils";

const STEP_SECONDS = 5;
const BIG_STEP_SECONDS = 30;

type Props = {
  /** 0..1 through the timeline, or null until the duration is known. */
  ratio: number | null;
  /** 0..1 buffered ahead of the playhead, or null when unknown. */
  buffered: number | null;
  current: number;
  duration: number;
  onSeek: (ratio: number) => void;
};

/**
 * A draggable position indicator for the active video.
 *
 * Replaces the old non-interactive progress hairline: dragging scrubs, the
 * keyboard works, and the elapsed/total readout makes it obvious the video
 * can be moved. The track stops pointer propagation because the feed treats
 * a drag on the slide as a swipe between posts — without that, seeking
 * sideways would advance the feed instead.
 */
export function SeekBar({ ratio, buffered, current, duration, onSeek }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [scrub, setScrub] = useState<number | null>(null);

  const known = Number.isFinite(duration) && duration > 0;
  // While a drag is in flight its position wins, so incoming playback
  // progress can't yank the handle back under the finger.
  const position = scrub ?? (known ? ratio : null);
  const shown = position != null ? position * duration : current;

  const ratioAt = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!known) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrub(ratioAt(e.clientX));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrub == null) return;
    e.stopPropagation();
    setScrub(ratioAt(e.clientX));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrub == null) return;
    e.stopPropagation();
    const target = ratioAt(e.clientX);
    setScrub(null);
    onSeek(target);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!known) return;
    const from = position ?? 0;
    const step = (e.shiftKey ? BIG_STEP_SECONDS : STEP_SECONDS) / duration;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = from + step;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = from - step;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = 1;
    if (next == null) return;
    e.preventDefault();
    e.stopPropagation();
    onSeek(Math.min(1, Math.max(0, next)));
  };

  const played = position != null ? position * 100 : 0;
  const ready = buffered != null ? Math.min(100, buffered * 100) : 0;

  return (
    <div className="pointer-events-auto w-full pt-2 select-none">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={known ? 0 : -1}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.round(duration))}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={`${formatTime(shown)} of ${formatTime(duration)}`}
        aria-disabled={!known}
        className="group relative flex h-5 touch-none items-center outline-none focus-visible:ring-2 focus-visible:ring-fg/70"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <div className="h-1 w-full overflow-hidden rounded-full bg-fg/20">
          <div className="h-full bg-fg/35" style={{ width: `${ready}%` }} />
        </div>
        <div
          className="pointer-events-none absolute h-1 rounded-full bg-fg/85"
          style={{ width: `${played}%` }}
        />
        <div
          className="pointer-events-none absolute size-3 -translate-x-1/2 rounded-full bg-fg opacity-80 shadow-[var(--shadow-border)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          style={{ left: `${played}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px] leading-tight tabular-nums text-fg/70">
        <span>{formatTime(shown)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
