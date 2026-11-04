import { useEffect, useState } from "react";
import { ExternalLink, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isHandle, normalizeHandle } from "@/lib/twitter/parse";
import { loadTwitterFeed } from "@/lib/twitter/loader";
import { useServerToken } from "@/lib/twitter/use-server-token";
import { useFlick } from "@/store/flick";
import { cn } from "@/lib/utils";

/**
 * The X lane's settings, next to Reddit's rather than behind a second sign-in:
 * an account is public, so all this needs is a handle, and a token is an opt-in
 * upgrade to the real API rather than a prerequisite.
 */

/** How much of the deck X may take, handed to the mixer as `maxShare`. */
const SHARE_PRESETS: { label: string; value: number; hint: string }[] = [
  { label: "Fewer", value: 0.25, hint: "a tweet every fourth slide" },
  { label: "Balanced", value: 0.5, hint: "neither host above half" },
  { label: "Every post", value: 1, hint: "keeps all of both lanes" },
];

export function TwitterPanel() {
  const twitter = useFlick((s) => s.twitter);
  const setTwitter = useFlick((s) => s.setTwitter);
  const includeTwitter = useFlick((s) => s.includeTwitter);
  const setIncludeTwitter = useFlick((s) => s.setIncludeTwitter);
  const share = useFlick((s) => s.twitterShare);
  const setShare = useFlick((s) => s.setTwitterShare);
  const serverToken = useServerToken();

  const handle = twitter?.handle ?? "";
  const token = twitter?.bearerToken ?? "";
  const [showToken, setShowToken] = useState(() => Boolean(token));
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<{ ok: boolean; message: string } | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // A stale "34 posts found" line beside an edited handle is worse than none.
  useEffect(() => {
    setVerdict(null);
  }, [handle, token]);

  function update(patch: { handle?: string; bearerToken?: string }) {
    setTwitter({
      handle: patch.handle ?? handle,
      bearerToken: patch.bearerToken ?? token,
    });
  }

  async function check() {
    const normalized = normalizeHandle(handle);
    if (!isHandle(normalized)) {
      setVerdict({
        ok: false,
        message: "Add a handle first — the name after @, 1 to 15 characters.",
      });
      return;
    }
    setChecking(true);
    setVerdict(null);
    try {
      const feed = await loadTwitterFeed({ handle: normalized, bearerToken: token });
      const videos = feed.posts.filter((post) => post.kind === "video").length;
      setVerdict({
        ok: feed.posts.length > 0,
        message:
          feed.posts.length > 0
            ? `@${feed.username} answered with ${feed.posts.length} playable post${feed.posts.length === 1 ? "" : "s"} (${videos} with video), via ${feed.transport === "api" ? "the X API" : "the public embed feed"}.`
            : `@${normalized} answered, but nothing in it is playable here.`,
      });
    } catch (err) {
      setVerdict({
        ok: false,
        message: err instanceof Error ? err.message : "Could not reach X.",
      });
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-surface/60 p-4 shadow-[var(--shadow-border)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">X account</h2>
          <p className="text-xs leading-normal text-muted">
            Mixed into the same deck, in the same player.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={includeTwitter}
          aria-label="Include X in the shuffle"
          onClick={() => setIncludeTwitter(!includeTwitter)}
          className={cn(
            "relative mt-1 h-7 w-12 shrink-0 rounded-full transition-colors",
            includeTwitter ? "bg-primary" : "bg-surface-2",
          )}
        >
          <span
            className={cn(
              "absolute top-1 size-5 rounded-full bg-fg transition-transform",
              includeTwitter ? "translate-x-6" : "translate-x-1",
            )}
          />
        </button>
      </div>

      <div className={cn("flex flex-col gap-4", !includeTwitter && "opacity-60")}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="x-handle">Handle</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base text-subtle">
              @
            </span>
            <Input
              id="x-handle"
              value={handle}
              onChange={(e) => update({ handle: e.target.value })}
              onBlur={() => handle && update({ handle: normalizeHandle(handle) })}
              className="pl-8"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="nasa"
              disabled={!includeTwitter}
            />
          </div>
          {handle && !isHandle(normalizeHandle(handle)) ? (
            <p className="text-xs text-danger">
              X handles are 1-15 characters: letters, numbers and underscores.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="x-token">Bearer token</Label>
            <button
              type="button"
              className="text-xs text-muted underline-offset-4 hover:underline"
              onClick={() => setShowToken((v) => !v)}
            >
              {showToken ? "Hide" : "Show"}
            </button>
          </div>
          <Input
            id="x-token"
            type={showToken ? "text" : "password"}
            value={token}
            onChange={(e) => update({ bearerToken: e.target.value })}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={
              serverToken
                ? "Optional — this Flick already has one"
                : "Optional — blank uses the public embed feed"
            }
            disabled={!includeTwitter}
          />
          <p className="text-xs leading-normal text-subtle">
            {serverToken ? (
              <>
                This deployment was given <span className="text-fg">X_BEARER_TOKEN</span>, so the
                handle alone already pulls the full timeline. Pasting a token here overrides it with
                your own.
              </>
            ) : (
              <>
                Blank works: Flick reads the account&rsquo;s public embed feed, which is the ~20
                newest posts and needs no key. A token switches to the official API — real history,
                HD files, and it needs a plan with read access.
              </>
            )}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Mix</Label>
          <div className="flex gap-1.5">
            {SHARE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setShare(preset.value)}
                className={cn(
                  "flex-1 rounded-lg px-2 py-2 text-xs font-medium transition-colors",
                  Math.abs(share - preset.value) < 0.01
                    ? "bg-fg/15 text-fg"
                    : "bg-surface-2 text-muted hover:text-fg",
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-subtle">
            {SHARE_PRESETS.find((preset) => Math.abs(share - preset.value) < 0.01)?.hint ??
              "how the two lanes are spread"}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="md" disabled={checking} onClick={() => void check()}>
              <Radio className="size-4" />
              {checking ? "Checking…" : "Check account"}
            </Button>
            <button
              type="button"
              className="text-xs text-muted underline-offset-4 hover:underline"
              onClick={() => setShowHelp((v) => !v)}
            >
              {showHelp ? "Hide setup" : "Where does a token come from?"}
            </button>
          </div>
          {verdict ? (
            <p className={cn("text-xs leading-normal", verdict.ok ? "text-muted" : "text-danger")}>
              {verdict.message}
            </p>
          ) : null}
          {showHelp ? (
            <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-normal text-muted">
              <li>
                Open{" "}
                <a
                  className="text-fg underline-offset-4 hover:underline"
                  href="https://developer.x.com/en/portal/dashboard"
                  target="_blank"
                  rel="noreferrer"
                >
                  developer.x.com
                  <ExternalLink className="ml-1 inline size-3" />
                </a>{" "}
                and create a Project + App with <span className="text-fg">Read</span> post access.
              </li>
              <li>
                Copy the <span className="text-fg">Bearer Token</span> from its Keys and tokens tab
                — that is an app-only token, so it can read public accounts and can&rsquo;t post or
                read anything private.
              </li>
              <li>
                Paste it above. It is stored on this device and only sent to Flick&rsquo;s server.
              </li>
            </ol>
          ) : null}
        </div>
      </div>
    </section>
  );
}
