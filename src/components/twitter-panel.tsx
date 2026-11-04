import { useRef, useState } from "react";
import { FileInput, Radio, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseBookmarksFile } from "@/lib/twitter/bookmarks";
import { twitterReady, loadTwitterBookmarks } from "@/lib/twitter/loader";
import { useServerToken } from "@/lib/twitter/use-server-token";
import { useFlick } from "@/store/flick";
import { cn } from "@/lib/utils";

/**
 * The X lane's settings: a file, and optionally a token to finish reading it.
 *
 * Three things this screen has to say out loud, because each one is invisible
 * from the deck itself:
 *
 * - **The file is the source of truth for *which* tweets.** X only serves
 *   bookmarks to an OAuth 2.0 user-context token with `bookmark.read`; a Bearer
 *   token cannot list them, no matter what it says on the key. So Flick takes the
 *   export and uses the API only to look up the public tweets it names.
 * - **The file never leaves the device.** Only ids cross the wire, for lookup.
 *   That is worth stating on a screen that invites someone to upload something
 *   as personal as their bookmarks.
 * - **A JSON export needs no token at all.** Those rows carry their own media,
 *   so the lane plays offline; a CSV of URLs or a pasted list does not. The
 *   counts below make that difference visible instead of mysterious.
 */

/** How much of the deck X may take, handed to the mixer as `maxShare`. */
const SHARE_PRESETS: { label: string; value: number; hint: string }[] = [
  { label: "Fewer", value: 0.25, hint: "a bookmark every fourth slide" },
  { label: "Balanced", value: 0.5, hint: "neither source above half" },
  { label: "Every post", value: 1, hint: "keeps all of both lanes" },
];

function describeAge(importedAt: number): string {
  const minutes = Math.round((Date.now() - importedAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function TwitterPanel() {
  const twitter = useFlick((s) => s.twitter);
  const setTwitterToken = useFlick((s) => s.setTwitterToken);
  const setBookmarks = useFlick((s) => s.setBookmarks);
  const includeTwitter = useFlick((s) => s.includeTwitter);
  const setIncludeTwitter = useFlick((s) => s.setIncludeTwitter);
  const share = useFlick((s) => s.twitterShare);
  const setShare = useFlick((s) => s.setTwitterShare);
  const serverToken = useServerToken();

  const fileRef = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState("");
  const [verdict, setVerdict] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState<"" | "reading" | "testing">("");
  const [showHelp, setShowHelp] = useState(false);

  const token = twitter?.bearerToken ?? "";
  const imported = twitter?.bookmarks ?? null;
  const entries = imported?.entries ?? [];
  // Counted the way the loader counts, so "plays without a token" is a fact
  // about this file rather than an estimate about the format it came in.
  const playableOffline = entries.filter((entry) =>
    Boolean(entry.raw || entry.mediaUrls?.length),
  ).length;
  const needsLookup = entries.length - playableOffline;

  async function ingest(text: string, name: string) {
    setBusy("reading");
    setVerdict(null);
    try {
      const parsed = parseBookmarksFile(text, name);
      setBookmarks(parsed);
      const offline = parsed.entries.filter((entry) =>
        Boolean(entry.raw || entry.mediaUrls?.length),
      ).length;
      setVerdict({
        ok: true,
        message:
          `Imported ${parsed.entries.length} bookmarked tweet${parsed.entries.length === 1 ? "" : "s"} from ${name}` +
          `${parsed.rejected > 0 ? ` (${parsed.rejected} unreadable row${parsed.rejected === 1 ? "" : "s"} skipped)` : ""}. ` +
          (offline > 0
            ? `${offline} carry their media in the file and need no token.`
            : `All of them need a Bearer token to look up.`) +
          (parsed.shrunk ? ` The list was trimmed to fit this device.` : ""),
      });
    } catch (err) {
      setVerdict({
        ok: false,
        message: err instanceof Error ? err.message : "That file could not be read.",
      });
    } finally {
      setBusy("");
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    await ingest(await file.text(), file.name);
  }

  async function test() {
    if (!twitter || !twitterReady(twitter)) {
      setVerdict({ ok: false, message: "Import a file first — there is nothing to look up yet." });
      return;
    }
    setBusy("testing");
    setVerdict(null);
    try {
      const feed = await loadTwitterBookmarks(twitter);
      const videos = feed.posts.filter((post) => post.kind === "video").length;
      setVerdict({
        ok: feed.posts.length > 0,
        message:
          feed.posts.length > 0
            ? `This file plays: ${feed.posts.length} post${feed.posts.length === 1 ? "" : "s"} with media (${videos} video). ${
                feed.stats.requested > 0
                  ? `${feed.stats.resolved} of ${feed.stats.requested} ids resolved through the API.`
                  : `Resolved from the file alone — no API call was needed.`
              }`
            : `Nothing in that file has playable media. It is most likely a text-only export — a CSV with a media column, or JSON tweet objects, will work.`,
      });
    } catch (err) {
      setVerdict({ ok: false, message: err instanceof Error ? err.message : "Could not reach X." });
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-surface/60 p-4 shadow-[var(--shadow-border)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">X bookmarks</h2>
          <p className="text-xs leading-normal text-muted">
            Your saved posts, mixed into the same deck, in the same player.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={includeTwitter}
          aria-label="Include X bookmarks in the shuffle"
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
        {imported ? (
          <div className="flex flex-col gap-2 rounded-xl bg-surface-2 px-3 py-2.5">
            <p className="text-sm text-fg">
              {imported.entries.length.toLocaleString()} bookmark
              {imported.entries.length === 1 ? "" : "s"}
              <span className="text-muted">
                {" "}
                from {imported.fileName} · read as {imported.format} · imported{" "}
                {describeAge(imported.importedAt)}
              </span>
            </p>
            <p className="text-xs leading-normal text-muted">
              {playableOffline > 0 ? (
                <>
                  <span className="text-fg">{playableOffline}</span> carry media in the file and
                  play without any token.
                </>
              ) : (
                <>
                  This file lists tweets but not their media, so every entry needs the lookup below.
                </>
              )}
              {needsLookup > 0 ? (
                <>
                  {" "}
                  <span className="text-fg">{needsLookup.toLocaleString()}</span> need X to resolve.
                </>
              ) : null}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy !== ""}
                onClick={() => void test()}
              >
                <Radio className="size-4" />
                {busy === "testing" ? "Checking…" : "Check file"}
              </Button>
              <button
                type="button"
                className="text-xs text-muted underline-offset-4 hover:underline"
                onClick={() => fileRef.current?.click()}
              >
                Replace file
              </button>
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-danger underline-offset-4 hover:underline"
                onClick={() => {
                  setBookmarks(null);
                  setVerdict(null);
                }}
              >
                <Trash2 className="size-3.5" />
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              size="md"
              disabled={busy !== ""}
              onClick={() => fileRef.current?.click()}
            >
              <FileInput className="size-4" />
              {busy === "reading" ? "Reading…" : "Choose a bookmarks export"}
            </Button>
            <p className="text-xs leading-normal text-subtle">
              CSV, JSON, JSONL, or a text file of tweet links — whatever your export tool produced.
              The file is read in this browser and never uploaded; only tweet ids go to the lookup.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="x-paste">…or paste tweet links</Label>
              <textarea
                id="x-paste"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={3}
                spellCheck={false}
                placeholder={
                  "https://x.com/nasa/status/1234567890\nhttps://x.com/bts/status/9876543210"
                }
                className="w-full resize-y rounded-lg border border-line bg-surface/40 px-3 py-2 text-sm text-fg outline-none placeholder:text-subtle focus:border-fg/40"
              />
              <button
                type="button"
                disabled={busy !== "" || pasted.trim() === ""}
                className="self-start text-xs text-primary underline-offset-4 hover:underline disabled:opacity-40"
                onClick={() => {
                  const text = pasted;
                  setPasted("");
                  void ingest(text, "pasted links");
                }}
              >
                Add these
              </button>
            </div>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.json,.jsonl,.txt,text/csv,application/json"
          className="hidden"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="x-token">Bearer token</Label>
          <Input
            id="x-token"
            type="password"
            value={token}
            onChange={(e) => setTwitterToken(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={
              serverToken
                ? "Optional — this Flick already has one"
                : needsLookup > 0
                  ? "Needed to look up the ids in your file"
                  : "Optional — this file needs no lookup"
            }
            disabled={!includeTwitter}
          />
          <p className="text-xs leading-normal text-subtle">
            {serverToken ? (
              <>
                This deployment was given <span className="text-fg">X_BEARER_TOKEN</span>, so
                lookups already work here. Pasting a token overrides it with your own.
              </>
            ) : needsLookup === 0 && imported ? (
              <>
                Nothing to look up: every tweet in that file carries its own media, so this lane
                works with no token at all.
              </>
            ) : (
              <>
                An app-only read token. It can look up public tweets by id — it cannot list
                bookmarks, which is why the file is needed.
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

        {verdict ? (
          <p className={cn("text-xs leading-normal", verdict.ok ? "text-muted" : "text-danger")}>
            {verdict.message}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="self-start text-xs text-muted underline-offset-4 hover:underline"
            onClick={() => setShowHelp((v) => !v)}
          >
            {showHelp ? "Hide setup" : "How do I get my bookmarks out of X?"}
          </button>
          {showHelp ? (
            <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-normal text-muted">
              <li>
                X has no export button for bookmarks, and the official account archive does not
                include them — so use a browser extension that reads the bookmarks page while you
                are signed in and offers CSV or JSON. Anything that produces a tweet id per row
                works.
              </li>
              <li>
                Prefer the <span className="text-fg">JSON / full tweet</span> option if the tool has
                one: those rows carry their own video files, and the deck then plays without Flick
                ever calling the API.
              </li>
              <li>
                For the rest, add a <span className="text-fg">Bearer token</span> from{" "}
                <a
                  className="text-fg underline-offset-4 hover:underline"
                  href="https://developer.x.com/en/portal/dashboard"
                  target="_blank"
                  rel="noreferrer"
                >
                  developer.x.com
                </a>
                . Tweet lookup is a paid endpoint, so a plan without read access resolves nothing —
                and the file&rsquo;s own media still plays.
              </li>
              <li>
                Re-import after you save more. Flick never writes back to X: it cannot bookmark,
                unlike, or delete anything.
              </li>
            </ol>
          ) : null}
        </div>
      </div>
    </section>
  );
}
