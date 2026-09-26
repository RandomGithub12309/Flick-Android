import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trackAuthorizePopup } from "@/lib/reddit/authorize-watch";
import { redditDemoFeed } from "@/lib/reddit/functions";
import { NATIVE_REDIRECT_URI, isNative, openNativeAuthorize } from "@/lib/reddit/native-oauth";
import { shuffleInPlace } from "@/lib/utils";
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(() => isNative());
  const override = useFlick((s) => s.redditRedirectUri);
  const setOverride = useFlick((s) => s.setRedditRedirectUri);
  const [showOverride, setShowOverride] = useState(false);
  const defaultRedirect = useMemo(() => redirectUri(), []);
  // A pasted value wins, because Reddit only accepts the exact string already
  // registered on the app — which is not always one Flick chose.
  const oauthRedirect = override || defaultRedirect;

  async function authorizeInBrowser() {
    if (!clientId.trim()) {
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
