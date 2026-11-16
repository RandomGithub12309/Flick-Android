# Flick

A full-screen, swipeable player for **your saved Reddit posts**. Sound on by
default, NSFW shown, one unified video/image/gallery player.

## Sources

| Source | Where it comes from | Needs |
| --- | --- | --- |
| Reddit (Saved) | Your saved posts, via OAuth | A Reddit *installed app* ID (no secret) |
| Reddit (Sample) | A public mix of video subreddits | Nothing |

## Self-hosted Android APK

The Android app is completely self-contained in the APK and needs **no external
server or Vercel deployment**:

- `npm run build:android` bundles the React SPA into `dist/android`, synced
  into the APK via `npx cap sync android`.
- Reddit OAuth, saved-post paging, and Redgifs API calls run natively on-device
  via `CapacitorHttp` (`src/lib/reddit/reddit.native.ts`).
- Redgifs video streaming with HTTP Range support runs through an embedded
  loopback server (`LocalServer.java` on `127.0.0.1`) inside the Android app.

See [NATIVE_ANDROID.md](NATIVE_ANDROID.md) for setup and build details.

## Commands

```sh
npm run dev           # http://0.0.0.0:8080 (web dev server)
npm run build         # production web build
npm run build:android # static SPA bundle for Android APK
npm run typecheck
npm test              # node --test over src/lib
npm run android:sync
```
