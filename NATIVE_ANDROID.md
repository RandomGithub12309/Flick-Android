# Building the Flick Android app

Flick is **100% self-hosted inside the Android APK** — no Vercel deployment or
external backend is required.

- The React UI is bundled directly into the APK (`npm run build:android` ->
  `dist/android` -> `android/app/src/main/assets/public`).
- Reddit OAuth token exchange, saved-post paging, and Redgifs metadata lookups
  run directly from the device via `CapacitorHttp`.
- Redgifs MP4 Range streaming runs through an embedded loopback HTTP server
  (`LocalServer.java` on `127.0.0.1`) inside the Android app.

## One-time Reddit setup

1. **Register an installed app on Reddit** at `reddit.com/prefs/apps`:
   - type: **installed app** (not script or web app)
   - redirect URI: `flick://oauth`
2. Copy the App ID shown under the app name and paste it into Flick's Reddit
   setup screen.

## Automatic GitHub Actions build

Pushing to `main` (or triggering the **Build Flick Android APK** workflow
manually) automatically builds the web bundle, syncs Capacitor, compiles the
debug APK, and uploads `Flick-Android` (`app-debug.apk`) as a workflow artifact.

## Building locally

1. Build and sync the web assets:
   ```sh
   npm run build:android
   npx cap sync android
   ```
2. Build the debug APK:
   ```sh
   cd android && ./gradlew assembleDebug
   ```
   The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.
