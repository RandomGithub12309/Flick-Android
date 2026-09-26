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
