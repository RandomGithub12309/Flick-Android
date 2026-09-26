import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { completeOAuthCode } from "@/lib/reddit/oauth-complete";
import { useFlick } from "@/store/flick";

/**
 * Redirect URI for the packaged Android app. There's no live web page to
 * redirect back to, so Reddit hands control back via this custom URL scheme
 * instead — Android routes it straight into the app (see the intent-filter
 * in android/app/src/main/AndroidManifest.xml). This is also the exact
 * string to register as the redirect URI on the installed app at
 * reddit.com/prefs/apps.
 */
export const NATIVE_REDIRECT_URI = "flick://oauth";

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** Opens Reddit's authorize page in the system browser (Chrome Custom Tabs). */
export async function openNativeAuthorize(url: string): Promise<void> {
  await Browser.open({ url });
}

/**
 * Call once, near app start, on native platforms. Listens for the
 * `flick://oauth?code=...&state=...` deep link Reddit sends back after the
 * person authorizes, closes the browser tab, and completes sign-in.
 */
export function registerNativeOauthListener(): () => void {
  if (!isNative()) return () => {};

  const handlePromise = CapacitorApp.addListener("appUrlOpen", ({ url }) => {
    void Browser.close().catch(() => {});
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (`${parsed.protocol}//${parsed.host}` !== "flick://oauth") return;

    const error = parsed.searchParams.get("error");
    const code = parsed.searchParams.get("code");
    const state = parsed.searchParams.get("state") ?? "";
    const store = useFlick.getState();
    if (error) {
      store.setError("Reddit denied access.");
      store.setScreen("connect");
      return;
    }
    if (!code) {
      store.setError("Missing OAuth code.");
      store.setScreen("connect");
      return;
    }
    void completeOAuthCode(code, state);
  });

  return () => {
    void handlePromise.then((handle) => handle.remove());
  };
}
