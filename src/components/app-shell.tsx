import { useEffect } from "react";
import { ConnectForm } from "@/components/connect-form";
import { Feed } from "@/components/feed";
import { Landing } from "@/components/landing";
import { completeAuthorizeWatch, stopAuthorizeWatch } from "@/lib/reddit/authorize-watch";
import { completeOAuthCode } from "@/lib/reddit/oauth-complete";
import { registerNativeOauthListener } from "@/lib/reddit/native-oauth";
import { useFlick } from "@/store/flick";

function LoadingView() {
  const label = useFlick((s) => s.loadingLabel);
  const count = useFlick((s) => s.loadingCount);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 text-center">
      <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted">Flick</p>
      <p className="mt-4 text-lg text-fg">{label || "Loading…"}</p>
      {count > 0 ? (
        <p className="mt-2 tabular-nums text-sm text-muted">{count} posts</p>
      ) : null}
    </main>
  );
}

export function AppShell() {
  const screen = useFlick((s) => s.screen);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; code?: string; state?: string };
      if (data?.type !== "flick-oauth" || !data.code) return;
      // Sign-in succeeded — cancel the popup watcher so its timeout can't
      // overwrite the feed with a stale "sign-in failed" message.
      completeAuthorizeWatch();
      void completeOAuthCode(data.code, data.state ?? "");
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      stopAuthorizeWatch();
    };
  }, []);

  // Native (Android): Reddit hands back a flick://oauth deep link instead of
  // posting a message from a popup.
  useEffect(() => registerNativeOauthListener(), []);

  return (
    <div className="mx-auto min-h-dvh w-full max-w-md bg-bg md:shadow-[var(--shadow-border)]">
      {screen === "feed" ? (
        <Feed />
      ) : screen === "connect" ? (
        <ConnectForm />
      ) : screen === "loading" ? (
        <LoadingView />
      ) : (
        <Landing />
      )}
    </div>
  );
}
