import { Capacitor, CapacitorHttp } from "@capacitor/core";

/**
 * One HTTP call, two transports.
 *
 * Flick's server functions are thin `fetch` wrappers, so on the packaged
 * Android app they can run on the device instead of a Vercel function — the
 * requests carry no server secret (Reddit's installed-app flow sends the client
 * id with an *empty* password). What stops a plain `fetch` from working there
 * is CORS: reddit.com, oauth.reddit.com and the redgifs API all answer without
 * `Access-Control-Allow-Origin`, so a WebView page at `https://localhost` is
 * refused before the request leaves the device.
 *
 * `CapacitorHttp` is the way out, but it is deliberately NOT enabled through
 * the global `window.fetch` patch. That patch funnels every request through
 * `new Request(resource, options)`, and the fetch spec strips forbidden header
 * names from that — including `User-Agent`. Reddit rejects the stock Android
 * `Dalvik/…` agent outright, and redgifs gates its CDN on a desktop-Chrome
 * agent, so a silently dropped User-Agent turns every call into a 403. Calling
 * the plugin directly instead keeps the header an ordinary object property
 * that crosses the bridge intact, and skips CORS without patching anything
 * global.
 */

export type HttpRequest = {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /**
   * Form fields for a POST, sent as `application/x-www-form-urlencoded`. The
   * native plugin encodes an object natively; the web path encodes it here.
   */
  form?: Record<string, string>;
  /**
   * Abandon the request after this long. Applied on both transports: the WebView
   * `fetch` path uses an `AbortSignal`, and the native call uses the plugin's
   * own connect/read timeouts, because its bridge call does not honour a signal.
   */
  timeoutMs?: number;
};

export type HttpReply = {
  ok: boolean;
  status: number;
  /** Parsed JSON body, or `null` when the body wasn't JSON (an error page). */
  data: unknown;
};

/** The request as the native plugin wants it. */
function nativeOptions(req: HttpRequest) {
  const headers: Record<string, string> = { ...req.headers };
  if (req.form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  return {
    url: req.url,
    method: req.method ?? "GET",
    headers,
    // The native side urlencodes an object body itself; sending a pre-encoded
    // string here would be double-encoded.
    ...(req.form ? { data: req.form } : {}),
    // Text rather than JSON: a non-JSON error body (an HTML gateway page) must
    // not throw inside the plugin, and the callers already tolerate a null body.
    responseType: "text" as const,
    ...(req.timeoutMs
      ? {
          connectTimeout: req.timeoutMs,
          readTimeout: req.timeoutMs,
        }
      : {}),
  };
}

/** Parse a body that may not be JSON — callers treat that as "no data". */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function nativeRequest(req: HttpRequest): Promise<HttpReply> {
  const res = await CapacitorHttp.request(nativeOptions(req));
  const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? null);
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    data: parseJson(body),
  };
}

async function webRequest(req: HttpRequest): Promise<HttpReply> {
  const res = await fetch(req.url, {
    method: req.method ?? "GET",
    headers: req.headers,
    ...(req.form ? { body: new URLSearchParams(req.form).toString() } : {}),
    ...(req.timeoutMs ? { signal: AbortSignal.timeout(req.timeoutMs) } : {}),
  });
  return {
    ok: res.ok,
    status: res.status,
    data: parseJson(await res.text()),
  };
}

/**
 * Issue a JSON request, natively when packaged in the Android app and through
 * `fetch` everywhere else (dev server, Vercel). The reply is always
 * `{ ok, status, data }` — callers inspect `ok` themselves so the same code
 * paths produce the same error messages on both transports.
 */
export function httpJson(req: HttpRequest): Promise<HttpReply> {
  return Capacitor.isNativePlatform() ? nativeRequest(req) : webRequest(req);
}
