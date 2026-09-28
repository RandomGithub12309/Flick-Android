import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Flick's Android wrapper — the app itself, not a browser pointed at one.
 *
 * Flick is a full-stack app, and the web build runs that stack on Vercel. None
 * of it needs a server though: there is no database, no auth and no client
 * secret behind those server functions (Reddit issues an *installed app* with no
 * secret, and `basicAuth` sends the client id with an empty password). So the
 * packaged app runs the same calls on the device and the APK carries the whole
 * app with it. `npm run build:native` produces the bundle in `native/www`.
 *
 * Note there is deliberately **no** `server.url` here. Setting it is what would
 * turn this back into a thin shell loading a live deployment — which is the
 * old arrangement, and the reason the app used to break whenever the deployment
 * slept, moved or sat behind a Vercel login wall.
 *
 * The custom URL scheme below ("flick://oauth") is what lets Reddit hand
 * control back to this native app after the person authorizes in the
 * system browser — see src/lib/reddit/native-oauth.ts and
 * android/app/src/main/AndroidManifest.xml.
 *
 * Also deliberately absent: `plugins.CapacitorHttp.enabled`. The app does route
 * its API calls through Capacitor's native HTTP plugin to get past CORS, but it
 * calls that plugin directly rather than turning on the global `window.fetch`
 * patch the flag installs. That patch rebuilds every request through
 * `new Request(...)`, and the fetch spec drops forbidden header names on the
 * way in — `User-Agent` among them — which Reddit rejects outright. Enabling
 * the flag here would silently break sign-in. See src/lib/reddit/http.ts.
 */
const config: CapacitorConfig = {
  appId: "app.flick.saved",
  appName: "Flick",
  webDir: "native/www",
};

export default config;
