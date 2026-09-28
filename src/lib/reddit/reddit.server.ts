import { isValidRedgifsId, normalizeRedgifsId } from "./redgifs";
import { redgifsDirectUrl, redgifsStreamHeaders } from "./reddit-api";

/**
 * The parts of the Reddit/redgifs integration that genuinely need a server.
 *
 * Everything stateless moved to `reddit-api.ts`, which both this module's
 * server functions and the packaged Android app call — see `native-api.ts`. The
 * one thing left here is the media proxy, because streaming the redgifs CDN's
 * bytes needs a request origin the app can hand to `<video>`: the CDN links are
 * IP-signed and reject a WebView's own request outright.
 *
 * The packaged app has no such proxy. It plays the CDN link directly and lets
 * `RedgifsWebViewClient` (android/app/src/main/java/app/flick/saved/) re-issue
 * the request natively with the headers the CDN demands, so seeking still works.
 */

// Re-exported so the server functions, the API route and the tests keep
// importing the Reddit surface from one module, exactly as before the split.
export {
  exchangeCode,
  fetchDemoFeed,
  fetchMe,
  fetchSavedPage,
  refreshGrant,
  resolveRedgifsClip,
} from "./reddit-api";
export type { ClipPlayback, RedgifsClip, TokenBundle } from "./reddit-api";

/**
 * `GET /api/redgifs/<id>` — stream the clip's mp4 with the UA/Referer the CDN
 * demands. Range requests pass through so seeking works and mobile browsers
 * get the 206 + Accept-Ranges they require for `<video>`.
 */
export async function streamRedgifsFile(rawId: string, request: Request): Promise<Response> {
  const id = normalizeRedgifsId(rawId);
  if (!isValidRedgifsId(id)) {
    return Response.json({ error: "bad redgifs id" }, { status: 400 });
  }
  const target = await redgifsDirectUrl(id);
  if (!target) {
    return Response.json({ error: "redgifs lookup failed" }, { status: 502 });
  }

  const upstreamHeaders = new Headers(redgifsStreamHeaders(id));
  const range = request.headers.get("range");
  if (range) upstreamHeaders.set("Range", range);

  let upstream: Response;
  try {
    // No abort timeout: media bodies stream for the life of playback.
    upstream = await fetch(target, { headers: upstreamHeaders, redirect: "follow" });
  } catch {
    return Response.json({ error: "redgifs fetch failed" }, { status: 502 });
  }
  if (!upstream.ok && upstream.status !== 206 && upstream.status !== 416) {
    return Response.json({ error: `redgifs upstream ${upstream.status}` }, { status: 502 });
  }
  if (!upstream.body) {
    return Response.json({ error: "empty upstream body" }, { status: 502 });
  }

  const out = new Headers();
  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
  ]) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  if (!out.has("content-type")) out.set("content-type", "video/mp4");
  if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");
  out.set("cache-control", "private, max-age=600");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
