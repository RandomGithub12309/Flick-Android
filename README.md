# Flick

A full-screen, swipeable player for **your saved Reddit posts and one X account,
mixed into one deck**. Sound on by default, NSFW shown, one video player for
both hosts.

## How the deck is built

| Lane | Where it comes from | Needs |
| --- | --- | --- |
| Reddit | Your saved posts, via OAuth | A Reddit *installed app* ID (you paste it; there's no secret) |
| Reddit (sample) | A public mix of video subreddits | Nothing |
| X | One account's posts | A handle. A Bearer token is optional but gets you real history and HD files |

Both lanes are fetched at the same time, and either may fail without stopping the
other — a dead token or a rate-limited feed becomes a notice over the feed, not a
broken app. A tweet is normalised into Flick's own `FlickPost` shape
(`src/lib/reddit/types.ts`), which is why one player, one seek bar and one skip
policy serve both hosts.

Mixing happens in `src/lib/feed/mix.ts`: each lane is shuffled inside itself, no
lane is allowed above half the deck (configurable), and the shorter lane is
spread evenly through the longer one — so a tweet lands every few slides instead
of in a block at the end.

## Configuring the X lane

Open **Sources** on the landing screen and add a handle. That alone works: Flick
then reads the account's public embed feed (the ~20 newest posts, no key). Add a
Bearer token to use the official X API v2 instead — more history, HD `mp4`
renditions, view counts. **Check account** tells you which transport answered
before you press shuffle.

To give every deployment API access without asking each person for a token, set
these in the hosting environment (e.g. Vercel → Environment Variables):

| Variable | Effect |
| --- | --- |
| `X_BEARER_TOKEN` | App-only read token used when the app has none of its own |
| `X_API_BASE` | Override the API host (default `https://api.x.com`) — for a proxy of your own |

A token pasted in the app wins over the deployment's, so one deploy can serve
several accounts. Tokens are stored in the browser (like Reddit's) and are sent
only to Flick's own server functions, which call X with them.

## Commands

```
npm run dev         # http://0.0.0.0:8080
npm run build       # production build
npm run typecheck
npm test            # node --test over src/lib (parser, mixer, X request policy)
npm run android:sync
```

Building the APK — including why the WebView must point at a **production**
deployment URL — is covered in [NATIVE_ANDROID.md](NATIVE_ANDROID.md).

## Layout

- `src/lib/reddit/` — OAuth, saved-post paging, redgifs resolution, listing parser
- `src/lib/twitter/` — X parsers (v2 + embed payload shapes), server fetch, transports
- `src/lib/feed/` — the mixer and the loader that runs both lanes
- `src/components/` — `feed` (swipe, keys, skip policy), `post-slide`, `video-player`, `seek-bar`
- `src/store/flick.ts` — screens, the deck, per-device settings
