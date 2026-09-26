import { useFlick } from "@/store/flick";

/**
 * Reddit sign-in has no reliable failure signal.
 *
 * `redirect_uri` is validated against the value registered on the Reddit app
 * *before* the person ever presses Allow. When it doesn't match, Reddit fails
 * the grant at https://www.reddit.com/svc/shreddit/oauth-grant and answers with
 * a bare `{}` — it never redirects back to us. From the opener's side the popup
 * simply stops making progress, so the app cannot distinguish "still typing a
 * password" from "Reddit already refused and this is over".
 *
 * Two signals close that gap:
 *   1. The popup closing without us ever receiving the `flick-oauth` message
 *      means the person dismissed Reddit's refusal — report it immediately.
 *   2. A hard timeout catches the case where they leave the tab open.
 *
 * Without this the only feedback is a dead `{}` page, which reads as "the app is
 * broken" rather than "your redirect URI is wrong".
 */

/** Long enough to type a password and pass 2FA, short enough to still be useful. */
const HARD_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_MS = 500;

let hardTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function clearTimers(): void {
  if (hardTimer !== null) {
    clearTimeout(hardTimer);
    hardTimer = null;
  }
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function reportFailure(redirectUri: string): void {
  clearTimers();
  const store = useFlick.getState();
  store.setError(
    "Reddit ended sign-in without finishing. The redirect URI on your Reddit app must match " +
      `exactly — expected: ${redirectUri}`,
  );
  store.setScreen("connect");
}

/**
 * Watch the Reddit popup for the `flick-oauth` postMessage that ends a
 * successful sign-in. Call immediately after `window.open`. Pass `null` when the
 * popup was blocked and we fell back to a full-page redirect — only the hard
 * timeout applies then.
 */
export function trackAuthorizePopup(popup: Window | null, redirectUri: string): void {
  clearTimers();
  hardTimer = setTimeout(() => reportFailure(redirectUri), HARD_TIMEOUT_MS);
  if (!popup) return;
  pollTimer = setInterval(() => {
    if (popup.closed) reportFailure(redirectUri);
  }, POLL_MS);
}

/** Call from the `flick-oauth` message handler to declare success. */
export function completeAuthorizeWatch(): void {
  clearTimers();
}

/** Tear down on unmount so a pending timer can't fire into a gone component. */
export function stopAuthorizeWatch(): void {
  clearTimers();
}
