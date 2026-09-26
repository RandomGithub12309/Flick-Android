import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Flick's Android wrapper.
 *
 * Flick is a full-stack app (Reddit token exchange, saved-post fetching, etc.
 * all run as server functions), so the packaged app is a thin native shell
 * that loads the *live deployed* site — not a bundled static copy of it.
 *
 * >>> Deploy the web app first (e.g. to Vercel), then replace the URL below
 * >>> with that deployed https URL before running `npx cap sync android`.
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
    // TODO: replace with your deployed URL, e.g. "https://flick-saved.vercel.app"
    url: "https://REPLACE-WITH-YOUR-DEPLOYED-URL.vercel.app",
    cleartext: false,
  },
};

export default config;
