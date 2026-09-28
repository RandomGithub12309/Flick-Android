/**
 * Pure redgifs helpers — safe to import from client AND server code.
 *
 * The CDN behind `media.redgifs.com` signs clip URLs per requesting IP and
 * validates User-Agent/Referer, so a URL resolved on the server 403s in the
 * browser. Playback therefore goes through the same-origin proxy
 * (`src/routes/api/redgifs.$id.ts`), which resolves and streams bytes
 * server-side. These builders are the only place proxy URLs are minted.
 */

export function isValidRedgifsId(id: string): boolean {
  return typeof id === "string" && id.length >= 4 && id.length <= 64 && /^[a-z0-9]+$/i.test(id);
}

export function normalizeRedgifsId(id: string): string {
  return id.trim().toLowerCase();
}

/** Stable same-origin playback URL for a redgifs clip id. */
export function redgifsProxyUrl(id: string): string {
  return `/api/redgifs/${encodeURIComponent(normalizeRedgifsId(id))}`;
}

/**
 * What URL a resolved redgifs clip should carry.
 *
 * - `proxy` — the same-origin `/api/redgifs/<id>` route. The web app needs it:
 *   the CDN signs links per requesting IP and validates UA/Referer, so a link
 *   resolved in the browser 403s.
 * - `direct` — the CDN link itself, for the packaged Android app, where a
 *   native `WebViewClient` re-issues the request with the headers the CDN
 *   demands (see `RedgifsWebViewClient`). There is no server to proxy through.
 *
 * It lives here rather than in `reddit-api.ts` so the parser can use it too
 * without an import cycle.
 */
export type ClipPlayback = "proxy" | "direct";
