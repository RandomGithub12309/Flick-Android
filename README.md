# Flick

A full-screen, swipeable player for **your saved Reddit posts**. Sound on by
default, NSFW shown, nothing blurred — and it can run with no server but the one
on your phone.

## What's in the deck

| Feed       | Where it comes from                       | Needs                                                   |
| ---------- | ----------------------------------------- | ------------------------------------------------------- |
| Your saves | Reddit's `GET /user/me/saved`, over OAuth | A Reddit _installed app_ ID. There is no secret to keep |
| Sample mix | A public feed of video subreddits         | Nothing                                                 |

Everything Reddit hands back is normalised into one `FlickPost` shape
(`src/lib/reddit/types.ts`): `v.redd.it` clips with their separate audio track,
redgifs links (resolved server-side, then proxied so playback doesn't depend on
a CDN accepting browser headers), galleries, images, and text.

Ordering lives in `src/lib/feed/deck.ts`: one slide per distinct clip — a video
reposted in three subreddits costs one slide — then a shuffle, so a saved list
never plays as the week of saves it arrived as.

## Running it

Three shapes of the same build. `FLICK_TARGET` picks the one that fits where the
process will live.

| Where it runs            | Command                                         | Output                                            |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------- |
| This machine, developing | `npm run dev`                                   | Vite dev server on `0.0.0.0:8080`                 |
| Vercel                   | `npm run build`                                 | `.vercel/output` — per-function handlers          |
| **Your phone**           | `npm run build:phone` then `npm run phone:push` | `.output/` — one ~2.4 MB directory, run by `node` |

### The phone is the server

`npm run build:phone` runs the same Vite build with `FLICK_TARGET=node`, so Nitro
emits `node-server`: a single `.output/` folder holding the SSR renderer, the
server functions, the client, the service worker and the manifest. It runs with
`node .output/server/index.mjs` and needs nothing else on disk — no
`node_modules`, because every dependency was traced into the bundle. That is the
whole trick: the app is deployed exactly as it would be on Vercel, and the machine
it is deployed onto is the handset.

The APK is then a WebView on `http://127.0.0.1:8765`, and `flick` manages the
process:

```
flick start | run | status | stop | restart | url | open | logs [n]
```

Nothing on the server side needs a volume or a database — the deck is fetched from
Reddit at load time and the app's own state (session token, mute, age gate) lives
in the WebView's storage, which persists on its own. So a reboot costs you one
`flick start`, or nothing at all if you install the Termux:Boot autostart.

Why a copied build rather than a build on the device: Termux's Node cannot load
the glibc native addons Vite, Rolldown and Tailwind need, while a Nitro output
needs no addons at all. Build where the toolchain works, run where the app is.

Full walk-through, including the APK and what to do when it doesn't come up:
[NATIVE_ANDROID.md](NATIVE_ANDROID.md).

## Commands

```
npm run dev           # http://0.0.0.0:8080
npm run build         # production build for Vercel
npm run build:phone   # the self-runnable .output/ directory
npm run phone         # start what you just built, on this machine
npm run phone:push    # pack .output/ and print the phone-side one-liner
npm run phone:status  # is it up?  (also :logs :stop :run)
npm test              # node --test over src/lib and scripts
npm run typecheck
npm run lint
npm run android:sync
```

## Layout

- `src/lib/reddit/` — OAuth, saved-post paging, redgifs resolution, listing parser
- `src/lib/feed/` — deck rules (`deck.ts`), the fetch that fills it (`load.ts`)
- `src/components/` — `feed` (swipe, keys, skip policy), `post-slide`, `video-player`, `seek-bar`
- `src/store/flick.ts` — screens, the deck, per-device settings
- `scripts/phone-server.mjs` — the launcher: port, process, honest status
- `scripts/phone-install.sh` — the on-device half of the same story
- `vite.config.ts` — `FLICK_TARGET` decides Vercel output or a self-runnable server

## Privacy notes

The Reddit access token and every setting this app has live in the device's own
storage (`flick.v1`), not on a Flick server — and when you self-host there usually
isn't one. Flick reads your saves and nothing else: it never writes back, so it
cannot unsave, upvote, or mark anything seen. Redgifs playback is proxied through
whatever server the app is talking to, which on a phone is the phone.
