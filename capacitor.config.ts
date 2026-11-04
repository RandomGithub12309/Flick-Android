import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Flick's Android shell — pointed at a server, wherever that server runs.
 *
 * Flick is a full-stack app (Reddit saved-post fetching, redgifs resolution and
 * the OAuth code exchange all run as server functions), so the packaged app is
 * a thin native shell that loads a running Flick — not a bundled static copy of
 * it. What changed is *where* that server has to live: `FLICK_TARGET=node` builds
 * one self-contained directory that runs on the phone itself (`flick start` in
 * Termux, from `scripts/phone-install.sh`), so the default below is the device's
 * own loopback. Nothing is deployed anywhere to use the app.
 *
 * Override the URL to aim the same APK at a hosted deployment instead:
 *
 *   FLICK_SERVER_URL=https://flick-android.vercel.app npx cap sync android
 *
 * > If you do point it at Vercel, use the **production** alias. Preview
 * > deployments (`…-lr-0a58.vercel.app`) sit behind Deployment Protection and
 * > 302 to vercel.com/login, which paints a login wall in the WebView and fails
 * > every server function — including Reddit sign-in.
 *
 * `cleartext` is on because a local server is `http://`, and Android refuses
 * cleartext by default. That is safe here precisely because the address is
 * loopback: the traffic never leaves the device. It is also why
 * `FLICK_SERVER_URL` should stay `http://` only for `127.0.0.1`/`localhost`.
 *
 * The custom scheme below (flick://oauth) is what lets Reddit hand control back
 * to this app after the person authorizes in the system browser — see
 * src/lib/reddit/native-oauth.ts and android/app/src/main/AndroidManifest.xml.
 * It works the same for a loopback server: the deep link goes to the app, and
 * the app's WebView is the thing holding the session.
 */
const LOCAL_SERVER = "http://127.0.0.1:8765";

function serverUrl(): string {
  const raw = process.env.FLICK_SERVER_URL?.trim();
  return raw && raw.length > 0 ? raw : LOCAL_SERVER;
}

const config: CapacitorConfig = {
  appId: "app.flick.saved",
  appName: "Flick",
  webDir: "native/www",
  server: {
    url: serverUrl(),
    // Only ever needed for the loopback case; a hosted deployment is https and
    // simply ignores this.
    cleartext: serverUrl().startsWith("http://"),
  },
};

export default config;
