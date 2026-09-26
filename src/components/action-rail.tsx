import type { ReactNode } from "react";
import { Dices, ExternalLink, LogOut, Volume2, VolumeX } from "lucide-react";

type Props = {
  muted: boolean;
  permalink: string;
  onShuffle: () => void;
  onToggleMute: () => void;
  onSignOut?: () => void;
};

function RailButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1 text-fg transition-[scale,opacity] duration-150 ease-out active:scale-[0.96]"
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-bg/45 shadow-[var(--shadow-border)] backdrop-blur-sm">
        {children}
      </span>
      <span className="text-xs font-medium text-fg/90">{label}</span>
    </button>
  );
}

export function ActionRail({
  muted,
  permalink,
  onShuffle,
  onToggleMute,
  onSignOut,
}: Props) {
  return (
    <div className="absolute right-3 bottom-28 z-20 flex flex-col items-center gap-5 pb-safe">
      <RailButton label={muted ? "Sound" : "On"} onClick={onToggleMute}>
        {muted ? <VolumeX className="size-6" /> : <Volume2 className="size-6" />}
      </RailButton>
      <RailButton label="Shuffle" onClick={onShuffle}>
        <Dices className="size-6" />
      </RailButton>
      <a
        href={permalink}
        target="_blank"
        rel="noreferrer"
        className="flex flex-col items-center gap-1 text-fg transition-[scale,opacity] duration-150 ease-out active:scale-[0.96]"
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-bg/45 shadow-[var(--shadow-border)] backdrop-blur-sm">
          <ExternalLink className="size-5" />
        </span>
        <span className="text-xs font-medium text-fg/90">Reddit</span>
      </a>
      {onSignOut ? (
        <RailButton label="Out" onClick={onSignOut}>
          <LogOut className="size-5" />
        </RailButton>
      ) : null}
    </div>
  );
}
