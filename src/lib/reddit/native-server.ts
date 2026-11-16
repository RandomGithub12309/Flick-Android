import { Capacitor, registerPlugin } from "@capacitor/core";
import { setRedgifsProxyOrigin } from "./redgifs";

interface LocalServerPlugin {
  getPort(): Promise<{ port: number }>;
}

const LocalServer = registerPlugin<LocalServerPlugin>("LocalServer");

let initPromise: Promise<string> | null = null;

/**
 * Ensures the embedded Android loopback HTTP server port is known and wired
 * into `redgifsProxyUrl()`. Returns `""` on web.
 */
export function ensureLocalServer(): Promise<string> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve("");
  if (initPromise) return initPromise;
  initPromise = LocalServer.getPort()
    .then(({ port }) => {
      const origin = `http://127.0.0.1:${port}`;
      setRedgifsProxyOrigin(origin);
      return origin;
    })
    .catch(() => "");
  return initPromise;
}
