# Flick on an Android device

Flick is a full-stack app: saved-post fetching, redgifs resolution and the OAuth
code exchange all run as server functions, so the APK is a shell around a running
Flick rather than a static bundle. What you choose is only **where that server
runs**.

| Path                         | Server runs on       | You need                                             | Trade-off                                                                        |
| ---------------------------- | -------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| **A. Self-hosted** (default) | the phone, in Termux | Termux + `pkg install nodejs`, any computer to build | no account anywhere, works on a plane; one command to bring it up after a reboot |
| **B. Hosted**                | Vercel               | a Vercel project                                     | always up, reachable from other devices; your tokens go through a deploy you own |

Path A is the point of this repo's `android/` setup, and it does not need Android
Studio at all: Chrome's "Add to Home screen" gives a full-screen app with its own
icon. Build the APK (path B's last step) when you want the `flick://oauth` deep
link, which is what lets Reddit hand control back to the app without a browser
detour.

---

## A. Self-hosted: the phone is the server

### 1. Build the artifact (any computer with Node 20+)

```
npm ci
npm run build:phone
```

That is `npm run build` with `FLICK_TARGET=node`, which asks Nitro for its
`node-server` output instead of Vercel's. Result: `.output/`, about 2.4 MB,
containing the SSR renderer, the server functions, the client, the service worker
and the manifest. It runs on `node` alone — no `node_modules` beside it — because
every dependency was traced into the bundle at build time.

`npm run build` will **not** do this: Vercel's per-function output can only be
served by Vercel's routing.

### 2. Put it on the phone

```
npm run phone:push -- --serve
```

Packs `.output/`, the launcher and the installer into `flick-server.tar.gz`,
serves it on your LAN until the phone fetches it, and prints the exact command.
Prefer a cable: `npm run phone:push -- --adb` pushes it to
`/sdcard/Download/` instead (USB debugging on).

### 3. Install it on the phone

Install **Termux from F-Droid** — the Play Store build cannot run a server, and
Termux is being withdrawn from Play anyway. Then:

```
pkg install nodejs
cd ~/Download
curl -fSO http://<the-address-the-script-printed>/flick-server.tar.gz
tar -xzf flick-server.tar.gz
sh flick-server/phone-install.sh
```

The installer puts the build in `~/flick-server`, installs a `flick` command,
starts the server and opens it in a browser. Add `--boot` to also write the
Termux:Boot autostart (install the Termux:Boot app for that to fire).

### 4. Make it an app

Chrome's menu → **Add to home screen** (or **Install app**). If Chrome never
offers it, open `http://127.0.0.1:8765/?install=1` — the app serves its own
install page. Then, on that home-screen app:

- Sources → paste your Reddit _installed app_ ID → **Authorize in browser**.
  Register `http://127.0.0.1:8765/oauth` as the redirect URI on the Reddit app;
  the exact string the app will send is shown on that screen, and can be
  overridden there if your Reddit app already has one you cannot edit.
- Or skip Reddit entirely and shuffle the sample mix — it needs no account.

### Later

Rebuilding is steps 1–3 again; `phone-install.sh` replaces the folder and leaves a
running server alone rather than double-starting it.

```
flick status     # running: Serving on http://127.0.0.1:8765
flick logs       # what the server said (last 40 lines; `flick logs 200` for more)
flick stop       # and flick start
flick run        # foreground mode: logs in the terminal, Ctrl-C stops it
```

| Variable              | Effect                                                         |
| --------------------- | -------------------------------------------------------------- |
| `FLICK_PORT` / `PORT` | which port to bind (default `8765`; `FLICK_PORT` wins)         |
| `FLICK_ROOT`          | where `.output/` lives, if not beside the launcher             |
| `FLICK_HOME`          | where the pidfile and log live (default `~/.flick`)            |
| `FLICK_DATA_DIR`      | where the embedded Postgres persists, if anything writes to it |

`flick start --lan` binds `0.0.0.0` so other devices on your network can open the
same app — which means an unauthenticated Flick deck, on whatever network you are
standing on, to anyone who can reach the port. The launcher says so when it does
it.

### When it doesn't come up

| What you see                                      | What it means                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no built server at …/.output/server/index.mjs`   | you copied a repo instead of a build, or ran `npm run build`. Run `npm run build:phone`                                                                       |
| `Something else already answers on …:8765`        | a port clash — often yesterday's instance. `flick stop`, or `FLICK_PORT=8766 flick start`                                                                     |
| `the server process exited during startup`        | the log tail is printed with it; `flick logs` for the rest. Usually Node too old for the bundle (`node -v`, needs 20+)                                        |
| app shows "Flick's server isn't answering"        | the server is down: open Termux, `flick start`. That screen also lets you type another URL — a laptop on the LAN, say — and remembers it                      |
| sign-in works in Chrome, not in the installed app | you installed the PWA but registered `flick://oauth` on Reddit, or the reverse. The redirect URI on the Reddit app must match what the app shows you, exactly |

---

## B. The APK shell

Optional in both paths — the PWA is the app for most people. Use the APK when you
want the OAuth deep link, a real launcher icon, and an install that survives a
browser-data wipe.

`capacitor.config.ts` now reads the server URL from `FLICK_SERVER_URL` and
defaults to `http://127.0.0.1:8765` — path A's address — so a plain build gives
you the self-hosted app with no config edit:

```
npx cap sync android          # after any change to the config or the manifest
```

Then **open `android/` in Android Studio** (it bundles the SDK; this repo cannot
build an APK because Gradle needs the SDK and its own network access), let Gradle
sync, and **Build → Build App Bundle(s) / APK(s) → Build APK(s)**. Install
`android/app/build/outputs/apk/debug/app-debug.apk` ("install unknown apps" on for
whatever transfers it).

`android:usesCleartextTraffic="true"` is set in the manifest because a
device-local server is `http://`, and `server.cleartext` in the config follows the
same rule: on only while the URL is `http://`, which is safe precisely because
loopback traffic never leaves the device.

`webDir` (`native/www`) is the shell's own page — the offline screen you get when
the server isn't answering. It retries on a countdown, then stops and offers the
fix plus a field to point at another Flick. It is not a copy of the app, and
copying one in there would reintroduce the bug this design avoids: a stale bundle
that renders while the real one is being updated.

---

## C. Hosted instead

```
vercel --prod                                # vercel.json is already configured
FLICK_SERVER_URL=https://<production-alias> npx cap sync android
```

> **Production alias only.** A preview deployment looks like
> `https://flick-android-ehld5hhmk-lr-0a58.vercel.app` — the tell is the random
> suffix. Vercel puts previews behind **Deployment Protection**, so they
> 302-redirect to `vercel.com/login`; inside the WebView that renders a Vercel
> login wall asking for your account, and every server function fails, so Reddit
> sign-in can never complete.

Register `https://<production-alias>/oauth` as the redirect URI on the Reddit app
(`flick://oauth` if you are using the APK), and run `npx cap sync android` again
whenever you change `capacitor.config.ts`, a plugin, or `AndroidManifest.xml`.
