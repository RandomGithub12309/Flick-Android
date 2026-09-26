/**
 * Registers Flick's pass-through service worker (public/sw.js).
 *
 * Chrome requires a registered service worker with a fetch handler before it
 * will show the install prompt. Kept in its own file so the <head> can carry a
 * plain <script src> instead of an inline blob.
 */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Install stays unavailable offline; the app still works normally.
    });
  });
}
