import type { ReactNode } from "react";
import {
  Bookmark,
  BookmarkCheck,
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
  saved?: boolean;
  onShuffle: () => void;
  onToggleMute: () => void;
  onComments: () => void;
  onShare: () => void;
  onSave?: () => void;
  onUnsave?: () => void;
  onSignOut?: () => void;
};

function RailButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
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
      <span
        className={`flex size-11 items-center justify-center rounded-full shadow-[var(--shadow-border)] backdrop-blur-sm [@media(orientation:landscape)_and_(max-height:520px)]:size-9 ${
          active ? "bg-fg text-bg" : "bg-bg/50 text-fg"
        }`}
      >
        {children}
      </span>
      <span className="text-[11px] font-medium text-fg/90 drop-shadow [@media(orientation:landscape)_and_(max-height:520px)]:text-[10px]">
        {label}
      </span>
    </button>
  );
}

export function ActionRail({
  muted,
  permalink,
  sourceLabel = "Reddit",
  saved = false,
  onShuffle,
  onToggleMute,
  onComments,
  onShare,
  onSave,
  onUnsave,
  onSignOut,
}: Props) {
  return (
    <div
      className="absolute right-3 bottom-20 z-20 flex flex-col items-center gap-3.5 pb-safe [@media(orientation:landscape)_and_(max-height:520px)]:bottom-12 [@media(orientation:landscape)_and_(max-height:520px)]:grid [@media(orientation:landscape)_and_(max-height:520px)]:grid-cols-2 [@media(orientation:landscape)_and_(max-height:520px)]:gap-2"
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
      {onSave ? (
        <RailButton label={saved ? "Saved" : "Save"} active={saved} onClick={onSave}>
          {saved ? <BookmarkCheck className="size-5" /> : <Bookmark className="size-5" />}
        </RailButton>
      ) : null}
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
        <span className="flex size-11 items-center justify-center rounded-full bg-bg/50 shadow-[var(--shadow-border)] backdrop-blur-sm [@media(orientation:landscape)_and_(max-height:520px)]:size-9">
          <ExternalLink className="size-4" />
        </span>
        <span className="text-[11px] font-medium text-fg/90 drop-shadow [@media(orientation:landscape)_and_(max-height:520px)]:text-[10px]">
          {sourceLabel}
        </span>
      </a>
      {onSignOut ? (
        <RailButton label="Out" onClick={onSignOut}>
          <LogOut className="size-4" />
        </RailButton>
      ) : null}
    </div>
  );
}
