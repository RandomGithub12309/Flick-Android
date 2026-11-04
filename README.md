# Flick

A full-screen, swipeable player for **your saved Reddit posts and your X
bookmarks, mixed into one deck**. Sound on by default, NSFW shown, one video
player for both hosts.

## How the deck is built

| Lane | Where it comes from | Needs |
| --- | --- | --- |
| Reddit | Your saved posts, via OAuth | A Reddit *installed app* ID (you paste it; there's no secret) |
| Reddit (sample) | A public mix of video subreddits | Nothing |
| X | Your bookmarks, from a file you export | The export. A Bearer token only if it lists tweets without their media |

Both lanes are fetched at the same time, and either may fail without stopping the
other — a dead token or a bad lookup becomes a notice over the feed, not a broken
app. A tweet is normalised into Flick's own `FlickPost` shape
(`src/lib/reddit/types.ts`), which is why one player, one seek bar and one skip
policy serve both hosts.

Mixing happens in `src/lib/feed/mix.ts`: each lane is shuffled inside itself, no
lane is allowed above half the deck (configurable), and the shorter lane is
spread evenly through the longer one — so a bookmark lands every few slides
instead of in a block at the end.

## Why the X lane reads a file

X serves bookmarks through exactly one door: `GET /2/users/:id/bookmarks`, which
requires an **OAuth 2.0 user-context token** carrying `bookmark.read`. An
app-only Bearer token — the kind this app can hold without becoming a login
provider — is refused outright, and there is no public or embeddable surface for
bookmarks at all, because they are private. There is also no export button: X's
own account archive covers your tweets and likes, not what you saved from other
people.

So Flick splits the problem along the line where the privacy actually is:

- **Which tweets** — your export, read in your browser by
  `src/lib/twitter/bookmarks.ts`. Never uploaded, never stored on a server.
- **What they are** — tweet *ids* of public posts, resolved through the ordinary
  tweet-lookup endpoint, which an app-only token *can* read.

That split is also why a JSON export needs no token whatsoever: those rows carry
their own media, so they parse through the same function an API response does and
play offline.

## Configuring the X lane

Open **Sources** → *Choose a bookmarks export*. Any of these works:

| Shape | Needs a token? | Notes |
| --- | --- | --- |
| JSON / JSONL of tweet objects | No | Best option. Full media, dimensions, counts |
| CSV with a media column | No | Depends on the exporter writing one |
| CSV with only id/URL columns | Yes | Each id is looked up |
| A pasted list of status links | Yes | Ten seconds of work, no export tool |

X has no export for bookmarks, so people use a browser extension that reads the
bookmarks page while they are signed in. Prefer its **JSON / full tweet** option
if it has one.

**Check file** tells you what the deck will actually contain before you press
shuffle — how many rows parsed, how many play from the file alone, and how many
the API resolved.

Re-import after you save more. Flick never writes back to X: it cannot bookmark,
like, or delete anything, and it cannot see a bookmark you removed.

### Deployment-wide token

To let every device resolve ids without pasting a token, set these in the hosting
environment (e.g. Vercel → Environment Variables):

| Variable | Effect |
| --- | --- |
| `X_BEARER_TOKEN` | App-only read token used when the app has none of its own |
| `X_API_BASE` | Override the API host (default `https://api.x.com`) — for a proxy of your own |

A token pasted in the app wins over the deployment's, so one deploy can serve
several people. Tokens are stored in the browser (like Reddit's) and are sent only
to Flick's own server functions, which call X with them.

Tweet lookup is a paid endpoint. A plan without read access resolves nothing — the
`missing` count and the notice say so rather than showing an empty deck.

## Commands

```
npm run dev         # http://0.0.0.0:8080
npm run build       # production build
npm run typecheck
npm test            # node --test over src/lib (importer, parsers, mixer, request policy)
npm run android:sync
```

Building the APK — including why the WebView must point at a **production**
deployment URL — is covered in [NATIVE_ANDROID.md](NATIVE_ANDROID.md).

## Layout

- `src/lib/reddit/` — OAuth, saved-post paging, redgifs resolution, listing parser
- `src/lib/twitter/` — bookmarks importer (`bookmarks.ts`), X→`FlickPost` parser, id lookup (`x.server.ts`)
- `src/lib/feed/` — the mixer and the loader that runs both lanes
- `src/components/` — `feed` (swipe, keys, skip policy), `post-slide`, `video-player`, `seek-bar`
- `src/store/flick.ts` — screens, the deck, per-device settings

## Privacy notes

The bookmark list is the most personal thing in this app, so it is also the thing
that stays home: the file is read in the browser, only tweet *ids* are sent to the
lookup, and the import lives in this device's storage (`flick.v1`) — signing out of
Reddit keeps it, and clearing site data removes it. Nothing in `src/` writes the
import to a server, and `X_API_BASE` exists so a deployment can route lookups
through its own proxy rather than X directly.
