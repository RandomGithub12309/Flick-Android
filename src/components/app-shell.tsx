import { useEffect } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { ConnectForm } from "@/components/connect-form";
import { Feed } from "@/components/feed";
import { Landing } from "@/components/landing";
import { completeAuthorizeWatch, stopAuthorizeWatch } from "@/lib/reddit/authorize-watch";
import { completeOAuthCode } from "@/lib/reddit/oauth-complete";
import { isNative, registerNativeOauthListener } from "@/lib/reddit/native-oauth";
import { ensureLocalServer } from "@/lib/reddit/native-server";
import { useFlick } from "@/store/flick";

function LoadingView() {
  const label = useFlick((s) => s.loadingLabel);
  const count = useFlick((s) => s.loadingCount);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 text-center">
      <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted">Flick</p>
      <p className="mt-4 text-lg text-fg">{label || "Loading…"}</p>
      {count > 0 ? <p className="mt-2 tabular-nums text-sm text-muted">{count} posts</p> : null}
    </main>
  );
}

export function AppShell() {
  const screen = useFlick((s) => s.screen);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; code?: string; state?: string };
      if (data?.type !== "flick-oauth" || !data.code) return;
      completeAuthorizeWatch();
      void completeOAuthCode(data.code, data.state ?? "");
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      stopAuthorizeWatch();
    };
  }, []);

  useEffect(() => {
    void ensureLocalServer();
    const stopOauth = registerNativeOauthListener();
    if (!isNative()) return stopOauth;

    const backPromise = CapacitorApp.addListener("backButton", () => {
      const state = useFlick.getState();
      if (state.screen !== "home") {
        state.setScreen("home");
      } else {
        void CapacitorApp.exitApp();
      }
    });

    return () => {
      stopOauth();
      void backPromise.then((h) => h.remove());
    };
  }, []);

  return (
    <div
      className={`mx-auto min-h-dvh w-full bg-bg ${screen === "feed" ? "max-w-none" : "max-w-md md:shadow-[var(--shadow-border)]"}`}
    >
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
