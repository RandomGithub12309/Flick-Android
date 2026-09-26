import { redditExchangeCode } from "@/lib/reddit/functions";
import { loadAllSaved } from "@/lib/reddit/load-saved";
import { shuffleInPlace } from "@/lib/utils";
import { useFlick } from "@/store/flick";

type PendingOauth = {
  state: string;
  clientId: string;
  redirectUri: string;
};

export function readPendingOauth(): PendingOauth | null {
  const raw = sessionStorage.getItem("flick.oauth");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingOauth;
  } catch {
    return null;
  }
}

/**
 * Finishes signing in once Reddit has handed back an authorization `code`.
 * Shared by the popup-based web flow, the full-page /oauth redirect, and the
 * native custom-scheme deep link — all three just differ in how they obtain
 * `code`/`state` in the first place.
 */
export async function completeOAuthCode(code: string, state: string): Promise<void> {
  const store = useFlick.getState();
  const saved = readPendingOauth();
  if (!saved) {
    store.setError("OAuth session expired. Tap Authorize again.");
    store.setScreen("connect");
    return;
  }
  if (saved.state !== state) {
    store.setError("OAuth state mismatch. Try authorizing again.");
    store.setScreen("connect");
    return;
  }
  try {
    store.setLoading("Signing in with Reddit…");
    const tokens = await redditExchangeCode({
      data: {
        code,
        redirectUri: saved.redirectUri,
        clientId: saved.clientId,
      },
    });
    const session = {
      username: tokens.username,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      clientId: saved.clientId,
    };
    store.setSession(session);
    const posts = await loadAllSaved(session);
    store.setPosts(shuffleInPlace(posts), "saved");
    sessionStorage.removeItem("flick.oauth");
  } catch (err) {
    store.setError(err instanceof Error ? err.message : "OAuth failed.");
    store.setScreen("connect");
  }
}
