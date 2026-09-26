import { useRef, useState } from "react";
import {
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  playbackRateFromRatio,
  ratioFromPlaybackRate,
} from "@/lib/reddit/playback-rate";
import { cn } from "@/lib/utils";

type Props = {
  rate: number;
  onChange: (rate: number) => void;
};

/**
 * Draggable playback-speed control.
 *
 * Lives inside the slide, which is wrapped in the feed's vertical-swipe
 * gesture handler, so every pointer event here stops propagation — otherwise
 * scrubbing sideways would also fling you to the next post. Pointer capture
 * keeps the drag alive when the finger leaves the bar.
 */
export function SpeedBar({ rate, onChange }: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const ratio = ratioFromPlaybackRate(rate);

  const applyFromClientX = (clientX: number) => {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    if (rect.width === 0) return;
    onChange(playbackRateFromRatio((clientX - rect.left) / rect.width));
  };

  return (
    <div
      className="absolute inset-x-0 top-0 z-30 px-4 pt-2 select-none"
      // The slide's own handler treats this as a vertical swipe otherwise.
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerCancel={(e) => e.stopPropagation()}
    >
      <div
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-label="Playback speed"
        aria-valuemin={MIN_PLAYBACK_RATE}
        aria-valuemax={MAX_PLAYBACK_RATE}
        aria-valuenow={Number(rate.toFixed(2))}
        aria-valuetext={`${rate.toFixed(2)} times`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          applyFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging) applyFromClientX(e.clientX);
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.5 : 0.1;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            onChange(rate + step);
          }
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            onChange(rate - step);
          }
          if (e.key === "Home") {
            e.preventDefault();
            onChange(MIN_PLAYBACK_RATE);
          }
          if (e.key === "End") {
            e.preventDefault();
            onChange(MAX_PLAYBACK_RATE);
          }
        }}
        className={cn(
          "relative flex h-7 touch-none items-center",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-fg/20">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-100 ease-out"
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        <div
          className={cn(
            "pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-primary shadow-[var(--shadow-border)] transition-transform duration-100",
            dragging && "scale-125",
          )}
          style={{ left: `${ratio * 100}%` }}
        />
      </div>
      <p
        className={cn(
          "mt-0.5 text-right text-[10px] font-medium tabular-nums text-fg/85 transition-opacity",
          dragging ? "opacity-100" : "opacity-60",
        )}
      >
        {rate.toFixed(2)}×
      </p>
    </div>
  );
}
