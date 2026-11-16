import { useMemo, useState } from "react";
import { Browser } from "@capacitor/browser";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { refreshDeck } from "@/lib/feed/load";
import { trackAuthorizePopup } from "@/lib/reddit/authorize-watch";
import { NATIVE_REDIRECT_URI, isNative, openNativeAuthorize } from "@/lib/reddit/native-oauth";
import {
  isNativeTwitterAuthSupported,
  loginTwitterNative,
  logoutTwitterNative,
} from "@/lib/twitter/native-auth";
import { parseTwitterCookies } from "@/lib/twitter/parse";
import { fetchTwitterBookmarksPage } from "@/lib/twitter/twitter.native";
import { DEFAULT_SUBREDDITS, useFlick } from "@/store/flick";

function redirectUri(): string {
  if (isNative()) return NATIVE_REDIRECT_URI;
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/oauth`;
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function ConnectForm() {
  const setScreen = useFlick((s) => s.setScreen);
  const setError = useFlick((s) => s.setError);
  const error = useFlick((s) => s.error);
  const session = useFlick((s) => s.session);
  const signOut = useFlick((s) => s.signOut);
  const twitterSession = useFlick((s) => s.twitterSession);
  const setTwitterSession = useFlick((s) => s.setTwitterSession);
  const signOutTwitter = useFlick((s) => s.signOutTwitter);
  const feedPlatform = useFlick((s) => s.feedPlatform);
  const setFeedPlatform = useFlick((s) => s.setFeedPlatform);
  const savedClientId = useFlick((s) => s.redditClientId);
  const setSavedClientId = useFlick((s) => s.setRedditClientId);
  const customSubreddits = useFlick((s) => s.customSubreddits);
  const setCustomSubreddits = useFlick((s) => s.setCustomSubreddits);
  const mediaFilter = useFlick((s) => s.mediaFilter);
  const setMediaFilter = useFlick((s) => s.setMediaFilter);
  const showNsfw = useFlick((s) => s.showNsfw);
  const setShowNsfw = useFlick((s) => s.setShowNsfw);

  const [clientId, setClientId] = useState(() => savedClientId);
  const [subsInput, setSubsInput] = useState(() => customSubreddits.join(", "));
  const [busy, setBusy] = useState(false);
  const [twitterBusy, setTwitterBusy] = useState(false);
  const [showManualX, setShowManualX] = useState(() => !isNativeTwitterAuthSupported());
  const [xAuthInput, setXAuthInput] = useState("");
  const [xCt0Input, setXCt0Input] = useState("");
  const [xHandleInput, setXHandleInput] = useState("");
  const [help, setHelp] = useState(() => isNative() && !savedClientId);
  const override = useFlick((s) => s.redditRedirectUri);
  const setOverride = useFlick((s) => s.setRedditRedirectUri);
  const [showOverride, setShowOverride] = useState(() =>
    Boolean(useFlick.getState().redditRedirectUri),
  );
  const defaultRedirect = useMemo(() => redirectUri(), []);
  const oauthRedirect = override || defaultRedirect;

  function saveSubreddits() {
    const parsed = subsInput
      .split(/[\s,]+/)
      .map((s) => s.replace(/^\/?r\//i, "").trim())
      .filter(Boolean);
    const next = parsed.length > 0 ? parsed : DEFAULT_SUBREDDITS;
    setCustomSubreddits(next);
    setSubsInput(next.join(", "));
  }

  async function authorizeInBrowser() {
    const trimmed = clientId.trim();
    if (!trimmed) {
      setError("Add your Reddit app ID first.");
      return;
    }
    setSavedClientId(trimmed);
    const state = randomState();
    sessionStorage.setItem(
      "flick.oauth",
      JSON.stringify({
        state,
        clientId: trimmed,
        redirectUri: oauthRedirect,
      }),
    );
    const url = new URL("https://www.reddit.com/api/v1/authorize.compact");
    url.searchParams.set("client_id", trimmed);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", oauthRedirect);
    url.searchParams.set("duration", "permanent");
    url.searchParams.set("scope", "identity history read");
    if (isNative()) {
      await openNativeAuthorize(url.toString());
      return;
    }
    const popup = window.open(url.toString(), "reddit-oauth", "width=480,height=740");
    if (!popup) {
      window.location.href = url.toString();
      return;
    }
    trackAuthorizePopup(popup, oauthRedirect);
  }

  async function playDemo() {
    saveSubreddits();
    setBusy(true);
    setError(null);
    try {
      await refreshDeck({ platform: "reddit", reddit: "demo" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo feed failed.");
      setScreen("connect");
    } finally {
      setBusy(false);
    }
  }

  async function connectTwitterWebView() {
    setTwitterBusy(true);
    setError(null);
    try {
      const res = await loginTwitterNative();
      setTwitterSession({
        authToken: res.authToken,
        ct0: res.ct0,
        username: res.screenName?.trim() || "x",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "X sign-in failed.";
      if (!msg.toLowerCase().includes("cancel")) {
        setError(msg);
      }
    } finally {
      setTwitterBusy(false);
    }
  }

  async function openExternalX() {
    setShowManualX(true);
    setError(null);
    const url = "https://x.com/home";
    if (isNative()) {
      await Browser.open({ url }).catch(() => {
        window.open(url, "_blank");
      });
    } else {
      window.open(url, "_blank");
    }
  }

  async function saveManualTwitter(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = parseTwitterCookies(xAuthInput, xCt0Input);
    if (!parsed) {
      setError("Enter both auth_token and ct0 (or paste a Cookie header containing both).");
      return;
    }
    const candidate = {
      authToken: parsed.authToken,
      ct0: parsed.ct0,
      username: xHandleInput.replace(/^@/, "").trim() || "x",
    };
    setTwitterBusy(true);
    try {
      const page = await fetchTwitterBookmarksPage(candidate, null, 1);
      setTwitterSession({
        ...candidate,
        username: page.username || candidate.username,
      });
      setXAuthInput("");
      setXCt0Input("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not verify X cookies.";
      setError(msg);
    } finally {
      setTwitterBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg px-5 pt-safe pb-safe">
      <header className="flex items-center gap-3 py-4">
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          onClick={() => setScreen("home")}
          aria-label="Back"
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div>
          <h1 className="text-lg font-semibold">Sources &amp; Filters</h1>
          <p className="text-sm text-muted">
            Connect Reddit or X bookmarks, or mix both into one deck.
          </p>
        </div>
      </header>

      {session || twitterSession ? (
        <div className="mb-6 flex flex-col gap-2">
          {session ? (
            <div className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3 shadow-[var(--shadow-border)]">
              <div>
                <p className="text-sm font-medium text-fg">Reddit · u/{session.username}</p>
                <p className="text-xs text-muted">Connected</p>
              </div>
              <Button variant="ghost" size="sm" onClick={signOut}>
                Sign out
              </Button>
            </div>
          ) : null}
          {twitterSession ? (
            <div className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3 shadow-[var(--shadow-border)]">
              <div>
                <p className="text-sm font-medium text-fg">
                  X · @{twitterSession.username || "connected"}
                </p>
                <p className="text-xs text-muted">Bookmarks connected</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  signOutTwitter();
                  void logoutTwitterNative();
                }}
              >
                Sign out
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <section className="mb-6 flex flex-col gap-3 rounded-xl bg-surface-2 p-4 shadow-[var(--shadow-border)]">
        <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Deck filters</h2>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: "mix", label: "Mix" },
              { id: "reddit", label: "Reddit" },
              { id: "twitter", label: "X" },
            ] as const
          ).map((opt) => (
            <Button
              key={opt.id}
              type="button"
              size="sm"
              variant={feedPlatform === opt.id ? "primary" : "ghost"}
              onClick={() => setFeedPlatform(opt.id)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mediaFilter === "all" ? "primary" : "ghost"}
            className="flex-1"
            onClick={() => setMediaFilter("all")}
          >
            All media
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mediaFilter === "video" ? "primary" : "ghost"}
            className="flex-1"
            onClick={() => setMediaFilter("video")}
          >
            Videos only
          </Button>
        </div>
        <Button
          type="button"
          size="sm"
          variant={showNsfw ? "secondary" : "ghost"}
          className="w-full justify-between"
          onClick={() => setShowNsfw(!showNsfw)}
        >
          <span>NSFW posts</span>
          <span className="text-xs text-muted">{showNsfw ? "Shown" : "Hidden"}</span>
        </Button>
      </section>

      <section className="mb-6 flex flex-col gap-3 rounded-xl bg-surface-2 p-4 shadow-[var(--shadow-border)]">
        <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
          X (Twitter) bookmarks
        </h2>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="lg"
            variant={isNativeTwitterAuthSupported() ? "secondary" : "primary"}
            className="w-full"
            disabled={twitterBusy}
            onClick={() => void openExternalX()}
          >
            <ExternalLink className="mr-2 size-4" />
            Sign in via external browser
          </Button>
          {isNativeTwitterAuthSupported() ? (
            <Button
              type="button"
              size="md"
              variant="ghost"
              className="w-full"
              disabled={twitterBusy}
              onClick={() => void connectTwitterWebView()}
            >
              {twitterBusy
                ? "Waiting for X sign-in…"
                : twitterSession
                  ? "Reconnect X in WebView (in-app)"
                  : "Sign in with X (in-app WebView)"}
            </Button>
          ) : null}
        </div>
        <button
          type="button"
          className="self-start text-left text-xs text-muted underline-offset-4 hover:underline"
          onClick={() => setShowManualX((v) => !v)}
        >
          {showManualX ? "Hide manual cookie entry" : "Paste session cookies manually"}
        </button>
        {showManualX ? (
          <form className="flex flex-col gap-3" onSubmit={saveManualTwitter}>
            <ol className="list-decimal space-y-1.5 rounded-lg bg-surface-1/60 p-3 pl-7 text-xs leading-normal text-muted">
              <li>
                Sign in to <span className="text-fg">x.com</span> in your external browser (avoids
                in-app WebView verification checks).
              </li>
              <li>
                Because X marks <code className="text-fg">auth_token</code> as{" "}
                <code className="text-fg">HttpOnly</code>, copy{" "}
                <code className="text-fg">auth_token</code> and{" "}
                <code className="text-fg">ct0</code> from a cookie manager extension (e.g.
                Cookie-Editor) or desktop DevTools → Application → Cookies →{" "}
                <span className="text-fg">https://x.com</span>.
              </li>
              <li>Paste both values (or a full Cookie header) below to verify and connect.</li>
            </ol>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="x-auth">auth_token (or full Cookie header)</Label>
              <Input
                id="x-auth"
                value={xAuthInput}
                onChange={(e) => setXAuthInput(e.target.value)}
                autoCapitalize="off"
                spellCheck={false}
                placeholder="Paste auth_token or auth_token=...; ct0=..."
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="x-ct0">ct0 (optional if included above)</Label>
              <Input
                id="x-ct0"
                value={xCt0Input}
                onChange={(e) => setXCt0Input(e.target.value)}
                autoCapitalize="off"
                spellCheck={false}
                placeholder="Paste ct0 CSRF token"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="x-handle">Your @handle (optional)</Label>
              <Input
                id="x-handle"
                value={xHandleInput}
                onChange={(e) => setXHandleInput(e.target.value)}
                autoCapitalize="off"
                spellCheck={false}
                placeholder="username"
              />
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <Button
              type="submit"
              size="md"
              variant="secondary"
              className="w-full"
              disabled={twitterBusy}
            >
              {twitterBusy ? "Verifying…" : "Save & verify X session"}
            </Button>
          </form>
        ) : null}
        <p className="text-xs leading-normal text-subtle">
          Uses your own logged-in X web session on this device to fetch your bookmarks directly — no
          paid X API key required.
        </p>
      </section>

      <section className="mb-6 flex flex-col gap-2">
        <Label htmlFor="subs">Sample / no-login subreddits</Label>
        <Input
          id="subs"
          value={subsInput}
          onChange={(e) => setSubsInput(e.target.value)}
          onBlur={saveSubreddits}
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Unexpected, nextfuckinglevel, ..."
        />
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="w-full"
          disabled={busy}
          onClick={() => void playDemo()}
        >
          Play subreddit mix
        </Button>
      </section>

      <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">
        Reddit account
      </h2>

      <form
        className="flex flex-col gap-4 pb-6"
        onSubmit={(e) => {
          e.preventDefault();
          void authorizeInBrowser();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cid">App ID</Label>
          <Input
            id="cid"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            required
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Paste the ID under the app name"
          />
        </div>

        {showOverride ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="redirect">Redirect URI already on your app</Label>
            <Input
              id="redirect"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              placeholder={defaultRedirect || "flick://oauth"}
              autoCapitalize="off"
              spellCheck={false}
            />
            <p className="text-xs leading-normal text-subtle">
              Reddit only accepts the exact redirect URI already registered on that app. Leave blank
              to use Flick&rsquo;s own:{" "}
              <span className="break-all text-muted">{defaultRedirect}</span>
            </p>
          </div>
        ) : (
          <button
            type="button"
            className="self-start text-left text-xs text-muted underline-offset-4 hover:underline"
            onClick={() => setShowOverride(true)}
          >
            Reusing an app whose redirect URI I can&rsquo;t change
          </button>
        )}

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <Button type="submit" size="lg" className="mt-2 w-full" disabled={busy}>
          Authorize in browser
        </Button>

        <button
          type="button"
          className="mt-2 text-left text-sm text-muted underline-offset-4 hover:underline"
          onClick={() => setHelp((v) => !v)}
        >
          {help ? "Hide setup" : "How do I get an App ID?"}
        </button>
        {help ? (
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-normal text-muted">
            <li>
              Open{" "}
              <a
                className="text-fg underline-offset-4 hover:underline"
                href="https://www.reddit.com/prefs/apps"
                target="_blank"
                rel="noreferrer"
              >
                reddit.com/prefs/apps
                <ExternalLink className="ml-1 inline size-3.5" />
              </a>{" "}
              and create an app. Set the type to <span className="text-fg">installed app</span> — do{" "}
              <span className="text-fg">not</span> pick script or web app.
            </li>
            <li>
              Redirect URI:{" "}
              <span className="break-all text-fg">
                {oauthRedirect || "http://localhost:8080/oauth"}
              </span>
            </li>
            <li>Copy the ID under the app name into the field above.</li>
          </ol>
        ) : null}
      </form>

      <p className="mt-auto pt-6 text-xs leading-normal text-subtle">
        Flick never sees your Reddit password — you sign in on reddit.com, and only the access token
        is stored on this device.
      </p>
    </div>
  );
}
