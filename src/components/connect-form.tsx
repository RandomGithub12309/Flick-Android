import { useMemo, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { refreshDeck } from "@/lib/feed/load";
import { trackAuthorizePopup } from "@/lib/reddit/authorize-watch";
import { NATIVE_REDIRECT_URI, isNative, openNativeAuthorize } from "@/lib/reddit/native-oauth";
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
      await refreshDeck({ reddit: "demo" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo feed failed.");
      setScreen("connect");
    } finally {
      setBusy(false);
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
          <h1 className="text-lg font-semibold">Reddit &amp; Filters</h1>
          <p className="text-sm text-muted">
            {session ? `Signed in as u/${session.username}` : "Connect your saved posts or customize subreddits."}
          </p>
        </div>
      </header>

      {session ? (
        <div className="mb-6 flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3 shadow-[var(--shadow-border)]">
          <div>
            <p className="text-sm font-medium text-fg">u/{session.username}</p>
            <p className="text-xs text-muted">Connected</p>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      ) : null}

      <section className="mb-6 flex flex-col gap-3 rounded-xl bg-surface-2 p-4 shadow-[var(--shadow-border)]">
        <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Deck filters</h2>
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
