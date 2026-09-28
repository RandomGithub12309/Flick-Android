# Building the Flick Android app

The Android app is **Flick itself**, not a browser pointed at a copy of it.
There is no Vercel deployment behind it: the app is a static bundle in the APK,
and the work its server functions used to do on a server runs on the device.

## Why there's no server

The server functions were never holding anything a server needed to hold:

- **No database.** `migrations/` holds only the opt-in auth schema, and
  nothing in Flick's routes imports `@/lib/db`. The PGLite fallback in
  `src/lib/db.ts` is unused template scaffolding.
- **No auth.** `VITE_AUTH_ENABLED` is `false`; Better Auth is off.
- **No secrets.** Flick is a Reddit *installed app*, which Reddit issues with
  no client secret, so the token exchange sends the client id with an empty
  password. The device already holds the user's access token; the old server
  was relaying it.

So `src/lib/reddit/reddit-api.ts` is plain, stateless `fetch` logic that runs
in either place, and `src/lib/reddit/functions.ts` picks the implementation per
platform. The web build still deploys to Vercel and still runs those handlers
as real server functions; the app just doesn't need one.

## Building the APK

1. **Build the bundle that ships in the app**

   ```
   npm run build:native
   ```

   This builds the client in TanStack Start's SPA mode (no Nitro — there is no
   server to deploy to) and assembles the result into `native/www`, which is
   what `capacitor.config.ts` points `webDir` at. It's generated output, so run
   it rather than committing it.

2. **Sync into the native project**

   ```
   npx cap sync android
   ```

3. **Build the APK**

   You'll need [Android Studio](https://developer.android.com/studio) (it
   bundles the Android SDK) — this repo can't build the APK itself since that
   needs the SDK and Gradle's own network access, neither of which are
   available here.

   1. Open the `android/` folder in Android Studio (or run `npx cap open android`).
   2. Let Gradle sync.
   3. **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
   4. Grab the APK from `android/app/build/outputs/apk/debug/app-debug.apk` and
      install it on your phone (enable "install unknown apps" for whichever app
      you use to transfer it).

   For a Play Store–ready build, use **Build → Generate Signed Bundle / APK**
   instead and follow Android Studio's signing wizard.

## Reddit sign-in

Register the installed app on Reddit at reddit.com/prefs/apps:

- type: **installed app**
- redirect URI: `flick://oauth`

(You'll also see this exact URI inside the app, in the "How do I get an App
ID?" panel on the sign-in screen — it's shown automatically whenever the app
detects it's running natively.)

Nothing else is needed: there is no deployment URL to register, and no
deployment that has to be awake for sign-in to work.

## How the two hard parts work

**CORS.** reddit.com, oauth.reddit.com, redgifs and the demo-feed API all
answer without `Access-Control-Allow-Origin`, so a WebView at
`https://localhost` is refused before the request leaves the phone.
`src/lib/reddit/http.ts` routes every call through Capacitor's native HTTP
plugin there.

It does that by calling `CapacitorHttp.request` **directly** rather than
enabling `plugins.CapacitorHttp.enabled` in `capacitor.config.ts`. The flag
installs a global `window.fetch` patch that rebuilds every request through
`new Request(...)`, and the fetch spec strips forbidden header names on the way
in — `User-Agent` among them. Reddit rejects the stock Android `Dalvik/…`
agent outright, so enabling the flag breaks sign-in. That's why the config has
no plugin block.

**redgifs video.** The redgifs CDN IP-signs its links and validates
`User-Agent` and `Referer`, so a `<video>` element's own request 403s — which
is why the web app plays the same-origin `/api/redgifs/<id>` proxy instead.
With no proxy origin to hand the player, the app resolves clips to the CDN link
itself (`ClipPlayback`, in `reddit-api.ts`) and
`android/.../RedgifsWebViewClient.java` catches the request, re-issues it
natively with the headers the CDN demands, and streams the body back —
forwarding `Range` so seeking still works. Reddit's own copy of the clip stays
on the post as the existing fallback, so a clip the CDN refuses degrades to
that rather than being skipped.

## Re-syncing after changes

Whenever you change `capacitor.config.ts`, add a Capacitor plugin, or edit
`AndroidManifest.xml`, run `npx cap sync android` again before rebuilding in
Android Studio.

And whenever you change the **web** code, re-run `npm run build:native` first —
the app has no server to pick up a deploy, so the bundle inside it only changes
when you rebuild it. That's the one real cost of dropping the server: a UI
change now needs a new APK, where before it just needed a redeploy.

## Tests

`src/lib/reddit/native-api.test.ts` covers the device transport without a
device, standing up a fake Capacitor bridge to check the things that only fail
on real hardware: that the form body crosses as an object (the plugin
urlencodes it itself, and a pre-encoded string would double-encode), that
`User-Agent` arrives intact, and that resolved clips carry a CDN URL rather
than a proxy route that doesn't exist on a device.
