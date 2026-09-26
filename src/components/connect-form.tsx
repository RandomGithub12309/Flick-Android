import { useMemo, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trackAuthorizePopup } from "@/lib/reddit/authorize-watch";
import { redditDemoFeed } from "@/lib/reddit/functions";
import { NATIVE_REDIRECT_URI, isNative, openNativeAuthorize } from "@/lib/reddit/native-oauth";
import { shuffleInPlace } from "@/lib/utils";
import { useFlick } from "@/store/flick";

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
  const setPosts = useFlick((s) => s.setPosts);
  const setError = useFlick((s) => s.setError);
  const error = useFlick((s) => s.error);

  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(() => isNative());
  const override = useFlick((s) => s.redditRedirectUri);
  const setOverride = useFlick((s) => s.setRedditRedirectUri);
  const [showOverride, setShowOverride] = useState(() => Boolean(useFlick.getState().redditRedirectUri));
  const defaultRedirect = useMemo(() => redirectUri(), []);
  // A pasted value wins, because Reddit only accepts the exact string already
  // registered on the app — which is not always one Flick chose.
  const oauthRedirect = override || defaultRedirect;

  async function authorizeInBrowser() {
    if (!clientId.trim()) {
      setError("Add your Reddit app ID first.");
      return;
    }
    const state = randomState();
    sessionStorage.setItem(
      "flick.oauth",
      JSON.stringify({
        state,
        clientId: clientId.trim(),
        redirectUri: oauthRedirect,
      }),
    );
    const url = new URL("https://www.reddit.com/api/v1/authorize.compact");
    url.searchParams.set("client_id", clientId.trim());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", oauthRedirect);
    url.searchParams.set("duration", "permanent");
    url.searchParams.set("scope", "identity history read");
    if (isNative()) {
      // Android: opens Reddit in a Custom Tab; it hands control back to the
      // app via the flick://oauth deep link (see native-oauth.ts).
      await openNativeAuthorize(url.toString());
      return;
    }
    const popup = window.open(url.toString(), "reddit-oauth", "width=480,height=740");
    // Reddit validates redirect_uri before the person presses Allow and fails
    // with a bare `{}` on its own endpoint if it doesn't match — no redirect
    // ever reaches us, so watch the popup ourselves or the user is stranded.
    if (!popup) {
      window.location.href = url.toString();
      return;
    }
    trackAuthorizePopup(popup, oauthRedirect);
  }

  async function playDemo() {
    setBusy(true);
    setError(null);
    useFlick.getState().setLoading("Shuffling a live Reddit mix…");
    try {
      const posts = await redditDemoFeed();
      setPosts(shuffleInPlace(posts), "demo");
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
          <h1 className="text-lg font-semibold">Sign in with Reddit</h1>
          <p className="text-sm text-muted">Pull every saved post, NSFW included.</p>
        </div>
      </header>

      <form
        className="flex flex-1 flex-col gap-4 pb-8"
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
              Reddit only accepts the exact redirect URI already registered on that app. Paste
              whatever is listed there — if it leaves Flick, the code never comes back. Leave blank
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
        <Button
          type="button"
          variant="ghost"
          size="md"
          className="w-full"
          disabled={busy}
          onClick={() => void playDemo()}
        >
          Play a sample feed
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
              <span className="text-fg">not</span> pick script or web app. Installed apps issue no
              client secret and Flick never asks for one; script and web apps are rejected at
              sign-in.
            </li>
            <li>
              Redirect URI:{" "}
              <span className="break-all text-fg">{oauthRedirect || "http://localhost:8080/oauth"}</span>
            </li>
            <li>
              That string must match your Reddit app <span className="text-fg">exactly</span> —
              Reddit checks it before you press Allow, and if it differs it fails the grant on its
              own page showing <span className="text-fg">{"{}"}</span> and never returns to Flick.
            </li>
            <li>Copy the ID under the app name into the field above.</li>
            <li>
              Already have an <span className="text-fg">installed app</span> you can&rsquo;t edit?
              Use the option above to paste its existing redirect URI. Flick sends whatever you put
              there, which is the only value Reddit will accept for that app.
            </li>
          </ol>
        ) : null}
        <p className="mt-auto text-xs leading-normal text-subtle">
          Flick never sees your Reddit password — you sign in on reddit.com and only the
          access token is stored on this device.
        </p>
      </form>
    </div>
  );
}
