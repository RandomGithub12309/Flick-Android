/**
 * Pure redgifs helpers — safe to import from client AND server code.
 *
 * The CDN behind `media.redgifs.com` signs clip URLs per requesting IP and
 * validates User-Agent/Referer, so a direct CDN URL 403s in the browser.
 * On web, playback goes through `/api/redgifs/<id>`.
 * On native Android, playback goes through the app's embedded loopback HTTP
 * server (`http://127.0.0.1:<port>/api/redgifs/<id>`).
 */

let proxyOrigin = "";

export function setRedgifsProxyOrigin(origin: string): void {
  proxyOrigin = origin.replace(/\/+$/, "");
}

export function isValidRedgifsId(id: string): boolean {
  return typeof id === "string" && id.length >= 4 && id.length <= 64 && /^[a-z0-9]+$/i.test(id);
}

export function normalizeRedgifsId(id: string): string {
  return id.trim().toLowerCase();
}

/** Stable playback URL for a redgifs clip id. */
export function redgifsProxyUrl(id: string): string {
  return `${proxyOrigin}/api/redgifs/${encodeURIComponent(normalizeRedgifsId(id))}`;
}

export function isRedgifsProxyUrl(url: string): boolean {
  return url.startsWith("/api/redgifs/") || /^https?:\/\/127\.0\.0\.1:\d+\/api\/redgifs\//.test(url);
}
