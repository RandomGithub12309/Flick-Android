import { ArrowRight, Settings2 } from "lucide-react";
import { useFlick } from "@/store/flick";
import { cn } from "@/lib/utils";

/**
 * Which lanes the next shuffle will pull, shown where the button is.
 *
 * A mix that quietly drops a lane — expired session, dead token, a toggle left
 * off — otherwise reads as a broken player. This is the one place that states
 * what is about to be fetched, and the entry point to changing it.
 */
export function SourceChips() {
  const session = useFlick((s) => s.session);
  const twitter = useFlick((s) => s.twitter);
  const includeTwitter = useFlick((s) => s.includeTwitter);
  const includeReddit = useFlick((s) => s.includeReddit);
  const setScreen = useFlick((s) => s.setScreen);

  const bookmarks = twitter?.bookmarks?.entries.length ?? 0;
  // Three states, because "off" and "nothing to read yet" send the person to
  // different fixes: one is a toggle, the other is a file.
  const twitterLabel = !includeTwitter
    ? "X off"
    : bookmarks > 0
      ? `X · ${bookmarks.toLocaleString()} bookmarks`
      : "X · add a bookmarks file";
  const redditLabel = session ? `Reddit · u/${session.username}` : "Reddit · sample mix";

  return (
    <button
      type="button"
      onClick={() => setScreen("connect")}
      className="flex w-full items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-left shadow-[var(--shadow-border)] transition-[scale] duration-150 active:scale-[0.99]"
    >
      <Settings2 className="size-4 shrink-0 text-subtle" />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <Chip on={includeReddit}>{includeReddit ? redditLabel : "Reddit off"}</Chip>
        <span className="text-xs text-subtle">+</span>
        <Chip on={includeTwitter && bookmarks > 0}>{twitterLabel}</Chip>
      </span>
      <ArrowRight className="size-4 shrink-0 text-subtle" />
    </button>
  );
}

function Chip({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "max-w-full truncate rounded-full px-2 py-0.5 text-xs font-medium",
        on ? "bg-fg/12 text-fg" : "bg-fg/5 text-subtle",
      )}
    >
      {children}
    </span>
  );
}
