import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  redditExchangeCode,
} from "@/lib/reddit/functions";
import { loadAllSaved } from "@/lib/reddit/load-saved";
import { shuffleInPlace } from "@/lib/utils";
import { useFlick } from "@/store/flick";

export const Route = createFileRoute("/oauth")({ component: OauthPage });

function OauthPage() {
  const [status, setStatus] = useState("Connecting to Reddit…");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const code = params.get("code");
    const state = params.get("state") ?? "";
    if (error) {
      setStatus("Reddit denied access.");
      return;
    }
    if (!code) {
      setStatus("Missing OAuth code.");
      return;
    }
    if (window.opener) {
      window.opener.postMessage({ type: "flick-oauth", code, state }, window.location.origin);
      setStatus("Signed in. You can close this window.");
      window.setTimeout(() => window.close(), 400);
      return;
    }
    void completeInPlace(code, state, setStatus);
  }, []);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 text-center">
      <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted">Flick</p>
      <p className="mt-4 text-lg text-fg">{status}</p>
    </main>
  );
}

async function completeInPlace(
  code: string,
  state: string,
  setStatus: (s: string) => void,
) {
  const raw = sessionStorage.getItem("flick.oauth");
  if (!raw) {
    setStatus("Session expired. Close this and tap Sign in again.");
    return;
  }
  const saved = JSON.parse(raw) as {
    state: string;
    clientId: string;
    redirectUri: string;
  };
  if (saved.state !== state) {
    setStatus("OAuth state mismatch.");
    return;
  }
  try {
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
    useFlick.getState().setSession(session);
    setStatus("Pulling your saved posts…");
    const posts = await loadAllSaved(session);
    useFlick.getState().setPosts(shuffleInPlace(posts), "saved");
    sessionStorage.removeItem("flick.oauth");
    window.location.replace("/");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "OAuth failed.");
  }
}
