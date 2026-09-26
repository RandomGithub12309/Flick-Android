import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Flick's Android wrapper.
 *
 * Flick is a full-stack app (Reddit token exchange, saved-post fetching, etc.
 * all run as server functions), so the packaged app is a thin native shell
 * that loads the *live deployed* site — not a bundled static copy of it.
 *
 * >>> This must be a *production* (production-alias) deployment URL.
 * >>> Preview deployment URLs (…-lr-0a58.vercel.app) are behind Vercel
 * >>> Deployment Protection and 302-redirect to vercel.com/login, which
 * >>> renders a login wall inside the WebView and breaks every server
 * >>> function call. Run `npx cap sync android` after changing it.
 *
 * The custom URL scheme below ("flick://oauth") is what lets Reddit hand
 * control back to this native app after the person authorizes in the
 * system browser — see src/lib/reddit/native-oauth.ts and
 * android/app/src/main/AndroidManifest.xml.
 */
const config: CapacitorConfig = {
  appId: "app.flick.saved",
  appName: "Flick",
  webDir: "native/www",
  server: {
    // Production deployment. Do NOT point this at a Vercel *preview* URL —
    // those are protected by a Vercel login wall that the WebView can't pass.
    url: "https://flick-android.vercel.app",
    cleartext: false,
  },
};

export default config;
