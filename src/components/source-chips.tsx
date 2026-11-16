import { ArrowRight, Settings2 } from "lucide-react";
import { useFlick } from "@/store/flick";

/**
 * Shows which Reddit source the next shuffle will pull, and opens the
 * Reddit connection screen on tap.
 */
export function SourceChips() {
  const session = useFlick((s) => s.session);
  const setScreen = useFlick((s) => s.setScreen);

  const redditLabel = session ? `Reddit · u/${session.username}` : "Reddit · sample mix";

  return (
    <button
      type="button"
      onClick={() => setScreen("connect")}
      className="flex w-full items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-left shadow-[var(--shadow-border)] transition-[scale] duration-150 active:scale-[0.99]"
    >
      <Settings2 className="size-4 shrink-0 text-subtle" />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <span className="max-w-full truncate rounded-full bg-fg/12 px-2 py-0.5 text-xs font-medium text-fg">
          {redditLabel}
        </span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-subtle" />
    </button>
  );
}
