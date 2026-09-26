# Building the Flick Android app

Flick's server functions (Reddit token exchange, fetching saved posts, etc.)
need a live backend, so the Android app is a thin native shell that loads
your *deployed* site in a WebView — it isn't a fully offline bundle. The only
native code is what lets Reddit hand control back to the app after sign-in.

## One-time setup

1. **Deploy the web app** (e.g. `vercel --prod` — `vercel.json` is already
   configured for it). Copy the deployed URL.
2. **Point the app at it** — edit `capacitor.config.ts` and replace
   `server.url` with that deployed URL.
3. **Register the installed app on Reddit** at reddit.com/prefs/apps:
   - type: **installed app**
   - redirect URI: `flick://oauth`
   (You'll also see this exact URI inside the app itself, in the "How do I
   get an App ID?" panel on the sign-in screen — it's shown automatically
   whenever the app detects it's running natively.)
4. Sync the config into the native project:
   ```
   npx cap sync android
   ```

## Building the APK

You'll need [Android Studio](https://developer.android.com/studio) (it
bundles the Android SDK) — this repo can't build the APK itself since that
needs the SDK and Gradle's own network access, neither of which are available
here.

1. Open the `android/` folder in Android Studio (or run
   `npx cap open android`).
2. Let Gradle sync.
3. **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
4. Grab the APK from `android/app/build/outputs/apk/debug/app-debug.apk` and
   install it on your phone (enable "install unknown apps" for whichever app
   you use to transfer it).

For a Play Store–ready build, use **Build → Generate Signed Bundle / APK**
instead and follow Android Studio's signing wizard.

## Re-syncing after changes

Whenever you change `capacitor.config.ts`, add a Capacitor plugin, or edit
`AndroidManifest.xml`, run `npx cap sync android` again before rebuilding in
Android Studio.
