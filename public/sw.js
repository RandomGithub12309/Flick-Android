/**
 * Flick service worker.
 *
 * Chrome will not fire the install prompt unless the page has a service worker
 * with a fetch handler, so Flick needs one purely to be installable — which its
 * own landing page promises ("Install to your home screen for a full-screen
 * app.").
 *
 * It deliberately caches NOTHING. Flick is a thin shell over a live deployment
 * and all of its state (the Reddit OAuth handshake, the server functions) is
 * per-request; a caching layer here would only serve a stale bundle after a
 * redeploy — the exact failure mode the Vercel preview alias already caused.
 * Pass-through satisfies the installability requirement at zero staleness risk.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // No respondWith() anywhere: every request goes straight to the network.
});
