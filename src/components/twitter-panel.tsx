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
 * The X lane's settings: a file, and one clear instruction about what has to be
 * in it.
 *
 * Everything on this screen exists to answer one question, because it is the one
 * people get stuck on: *"I pasted my bookmarks, why is the deck empty?"* A tweet
 * link is not a video. X's media files live at `video.twimg.com/ext_tw_video/…
 * /<opaque>/…mp4`, and that opaque segment is per-upload — it is not in the
 * status URL, not derivable from the id, and the only ways to get it are the API
 * (paid) or the file (free). So the file either carries media or it does not,
 * and the UI has to say which of those it got, in numbers, next to the thing
 * that fixes it.
 *
 * Three facts are stated rather than assumed:
 *
 * - **what will play**, from the file alone — so an empty deck is never a mystery;
 * - **the file never leaves the device** — only ids are sent for lookup, which
 *   matters more now that the input is a person's bookmark history;
 * - **a Bearer token is optional, not the recommended path** — it is the fallback
 *   for a media-less file, not a prerequisite, and it is worded that way.
 */

/** How much of the deck X may take, handed to the mixer as `maxShare`. */
const SHARE_PRESETS: { label: string; value: number; hint: string }[] = [
  { label: "Fewer", value: 0.25, hint: "a bookmark every fourth slide" },
  { label: "Balanced", value: 0.5, hint: "neither source above half" },
  { label: "Every post", value: 1, hint: "keeps all of both lanes" },
];

/**
 * The line format shown in the paste box.
 *
 * A placeholder is the only place most people will read the instructions, so it
 * carries the whole rule: link, space, video address.
 */
const PASTE_PLACEHOLDER = `One per line: <tweet link> <video address>

https://x.com/nasa/status/1577015903526453248 https://video.twimg.com/ext_tw_video/1577015903526453248/pu/vid/1280x720/Dr9kQ2pV.mp4

…or just the tweet links, if you have a Bearer token to look them up.`;

function describeAge(importedAt: number): string {
  const minutes = Math.round((Date.now() - importedAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** Counts computed the way the loader computes them, so nothing is estimated. */
function measurePlayability(entries: { raw?: unknown; mediaUrls?: string[] }[]) {
  const playable = entries.filter((entry) => Boolean(entry.raw || entry.mediaUrls?.length)).length;
  return { playable, needsLookup: entries.length - playable };
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
  const { playable, needsLookup } = measurePlayability(entries);
  const canResolve = Boolean(token) || serverToken;

  async function ingest(text: string, name: string) {
    setBusy("reading");
    setVerdict(null);
    try {
      const parsed = parseBookmarksFile(text, name);
      setBookmarks(parsed);
      const playableNow = parsed.entries.filter((entry) =>
        Boolean(entry.raw || entry.mediaUrls?.length),
      ).length;
      const total = parsed.entries.length;
      const skipped =
        parsed.rejected > 0
          ? ` ${parsed.rejected} row${parsed.rejected === 1 ? "" : "s"} had no tweet id or link and were skipped.`
          : "";
      setVerdict({
        ok: playableNow > 0,
        message:
          playableNow > 0
            ? `${playableNow} of ${total} rows from ${name} have media in the file, so they play right now.${skipped}`
            : `Imported ${total} from ${name}, but none of them carry media — a deck needs the video file, not just the link. ${
                canResolve
                  ? "The token on file will look them up; press Shuffle."
                  : "Either re-export as JSON with full tweet objects, or add the video address next to each link (see How to make it play below)."
              }${skipped}`,
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
      setVerdict({ ok: false, message: "Import a file first — there is nothing to check yet." });
      return;
    }
    setBusy("testing");
    setVerdict(null);
    try {
      const feed = await loadTwitterBookmarks(twitter);
      const videos = feed.posts.filter((post) => post.kind === "video").length;
      const fromFile = playable;
      setVerdict({
        ok: feed.posts.length > 0,
        message: feed.posts.length
          ? `This deck will play: ${feed.posts.length} post${
              feed.posts.length === 1 ? "" : "s"
            } with media (${videos} video). ${fromFile} came from your file alone${
              feed.stats.requested > 0
                ? `, and the API resolved ${feed.stats.resolved} of ${feed.stats.requested} looked-up ids.`
                : " — no API call was needed at all."
            }`
          : `Nothing playable. This file lists ${entries.length} tweet${
              entries.length === 1 ? "" : "s"
            } and none of them carry a media URL, and there is no token to look them up. Add the video address next to each link, or re-export as JSON.`,
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
              {playable > 0 ? (
                <>
                  <span className="font-medium">{playable.toLocaleString()} ready to play</span>
                  <span className="text-muted"> from {imported.fileName}</span>
                </>
              ) : (
                <>
                  <span className="font-medium text-danger">Nothing in this file can play yet</span>
                  <span className="text-muted"> ({imported.fileName})</span>
                </>
              )}
            </p>
            <p className="text-xs leading-normal text-muted">
              {entries.length.toLocaleString()} bookmark{entries.length === 1 ? "" : "s"} read as{" "}
              {imported.format}, imported {describeAge(imported.importedAt)}.
              {needsLookup > 0 ? (
                <>
                  {" "}
                  {needsLookup.toLocaleString()} are links only — they need{" "}
                  {canResolve ? (
                    <>
                      the lookup, which this Flick <span className="text-fg">can</span> do
                    </>
                  ) : (
                    <span className="text-fg">a Bearer token you do not have</span>
                  )}
                  .
                </>
              ) : (
                <> Every one of them carries its media, so this lane works with no API access.</>
              )}
              {imported.shrunk ? " The list was trimmed to fit this device." : ""}
            </p>
            {playable === 0 && needsLookup > 0 && !canResolve ? (
              <p className="rounded-lg bg-danger/10 px-2.5 py-2 text-xs leading-normal text-fg">
                To fix this without paying for the API: open a bookmark, right-click the video,{" "}
                <span className="font-medium">Copy video address</span>, and put that address on the
                same line as the tweet link. Then re-import.
              </p>
            ) : null}
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
              CSV, JSON, JSONL or a text file — read in this browser, never uploaded. JSON is the
              one to pick if your export tool offers it: those rows contain the video files
              themselves, so nothing else is needed.
            </p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="x-paste">…or paste them here</Label>
              <textarea
                id="x-paste"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={5}
                spellCheck={false}
                placeholder={PASTE_PLACEHOLDER}
                className="w-full resize-y rounded-lg border border-line bg-surface/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-fg outline-none placeholder:text-subtle focus:border-fg/40"
              />
              <button
                type="button"
                disabled={busy !== "" || pasted.trim() === ""}
                className="self-start text-xs text-primary underline-offset-4 hover:underline disabled:opacity-40"
                onClick={() => {
                  const text = pasted;
                  setPasted("");
                  void ingest(text, "pasted");
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
            {showHelp ? "Hide" : "How to make it play"} · no API key, no password, no paid plan
          </button>
          {showHelp ? (
            <div className="flex flex-col gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-xs leading-normal text-muted">
              <p className="text-fg">
                A tweet link is not a video. Flick needs the file URL, which looks like{" "}
                <span className="font-mono text-[11px]">video.twimg.com/…/…mp4</span> — and that
                address is not inside the tweet link, so it has to come from the file.
              </p>
              <ol className="list-decimal space-y-1.5 pl-5">
                <li>
                  Open your bookmarks on x.com. Right-click the video →{" "}
                  <span className="text-fg">Copy video address</span>.
                </li>
                <li>
                  Put both on one line, separated by a space, in the box above:
                  <pre className="mt-1 overflow-x-auto rounded bg-surface/60 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-fg">
                    https://x.com/user/status/1577…
                    https://video.twimg.com/ext_tw_video/1577…/pu/vid/1280x720/ab12CD.mp4
                  </pre>
                </li>
                <li>
                  For a whole library, use a bookmarks export{" "}
                  <span className="text-fg">extension</span> and choose its JSON / &ldquo;full
                  tweet&rdquo; option — that carries every clip, so you never touch the boxes below.
                  X&rsquo;s own account archive does not include bookmarks.
                </li>
                <li>
                  A photo link works too — anything ending in{" "}
                  <span className="font-mono text-[11px]">.jpg</span> on pbs.twimg.com becomes a
                  slide.
                </li>
              </ol>
              <p>
                A row with only a link is not lost: it just needs{" "}
                <span className="text-fg">GET /2/tweets</span> to resolve, which is what the token
                below is for. It is a paid endpoint, so skipping it is a reasonable choice.
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="x-token" className="text-subtle">
            Bearer token — optional
          </Label>
          <Input
            id="x-token"
            type="password"
            value={token}
            onChange={(e) => setTwitterToken(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={
              needsLookup === 0 && imported
                ? "Not needed — this file carries its own media"
                : "Only needed to resolve links that have no media"
            }
            disabled={!includeTwitter}
          />
          <p className="text-xs leading-normal text-subtle">
            {serverToken ? (
              <>
                This deployment already has <span className="text-fg">X_BEARER_TOKEN</span>, so
                link-only rows resolve without you pasting anything.
              </>
            ) : needsLookup === 0 && imported ? (
              <>
                Leave this empty: every bookmark in that file carries its media, so the lane needs
                no API access at all.
              </>
            ) : (
              <>
                Leave it empty if your file carries media — Flick then never calls the API. Fill it
                only to look up rows that are links. It reads public tweets by id; it cannot list
                bookmarks, which is why the file is needed in the first place.
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
              "how the two sources are spread"}
          </p>
        </div>
      </div>
    </section>
  );
}
