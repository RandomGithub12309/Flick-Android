import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Flick's self-hosted Android wrapper.
 *
 * The web app is bundled directly inside the APK (`dist/android` ->
 * `android/app/src/main/assets/public`) with no external server or Vercel
 * deployment required. Reddit/Redgifs API calls run natively via CapacitorHttp,
 * and Redgifs video range-streaming is served by the app's own embedded
 * loopback HTTP server (`LocalServer.java` on 127.0.0.1).
 *
 * `androidScheme: "http"` serves the bundled SPA on `http://localhost` so
 * `<video src="http://127.0.0.1:<port>/api/redgifs/...">` is not blocked as
 * mixed content by Android WebView.
 */
const config: CapacitorConfig = {
  appId: "app.flick.saved",
  appName: "Flick",
  webDir: "dist/android",
  server: {
    androidScheme: "http",
  },
};

export default config;
