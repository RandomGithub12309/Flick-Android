import type { ReactNode } from "react";
import {
  BookmarkMinus,
  Dices,
  ExternalLink,
  LogOut,
  MessageCircle,
  Share2,
  Volume2,
  VolumeX,
} from "lucide-react";

type Props = {
  muted: boolean;
  permalink: string;
  sourceLabel?: string;
  onShuffle: () => void;
  onToggleMute: () => void;
  onComments: () => void;
  onShare: () => void;
  onUnsave?: () => void;
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
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="flex flex-col items-center gap-0.5 text-fg transition-[scale,opacity] duration-150 ease-out active:scale-[0.94]"
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-bg/50 shadow-[var(--shadow-border)] backdrop-blur-sm">
        {children}
      </span>
      <span className="text-[11px] font-medium text-fg/90 drop-shadow">{label}</span>
    </button>
  );
}

export function ActionRail({
  muted,
  permalink,
  sourceLabel = "Reddit",
  onShuffle,
  onToggleMute,
  onComments,
  onShare,
  onUnsave,
  onSignOut,
}: Props) {
  return (
    <div
      className="absolute right-3 bottom-20 z-20 flex flex-col items-center gap-3.5 pb-safe"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <RailButton label={muted ? "Sound" : "On"} onClick={onToggleMute}>
        {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
      </RailButton>
      <RailButton label="Comments" onClick={onComments}>
        <MessageCircle className="size-5" />
      </RailButton>
      <RailButton label="Share" onClick={onShare}>
        <Share2 className="size-5" />
      </RailButton>
      <RailButton label="Shuffle" onClick={onShuffle}>
        <Dices className="size-5" />
      </RailButton>
      {onUnsave ? (
        <RailButton label="Unsave" onClick={onUnsave}>
          <BookmarkMinus className="size-5" />
        </RailButton>
      ) : null}
      <a
        href={permalink}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col items-center gap-0.5 text-fg transition-[scale,opacity] duration-150 ease-out active:scale-[0.94]"
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-bg/50 shadow-[var(--shadow-border)] backdrop-blur-sm">
          <ExternalLink className="size-4" />
        </span>
        <span className="text-[11px] font-medium text-fg/90 drop-shadow">{sourceLabel}</span>
      </a>
      {onSignOut ? (
        <RailButton label="Out" onClick={onSignOut}>
          <LogOut className="size-4" />
        </RailButton>
      ) : null}
    </div>
  );
}
