import { useEffect, useState } from "react";
import { Layers, Smartphone, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SourceChips } from "@/components/source-chips";
import { refreshDeck, requestFor } from "@/lib/feed/load";
import { useFlick } from "@/store/flick";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function Landing() {
  const ageOk = useFlick((s) => s.ageOk);
  const acceptAge = useFlick((s) => s.acceptAge);
  const setScreen = useFlick((s) => s.setScreen);
  const session = useFlick((s) => s.session);
  const error = useFlick((s) => s.error);
  const twitter = useFlick((s) => s.twitter);
  const includeTwitter = useFlick((s) => s.includeTwitter);
  const includeReddit = useFlick((s) => s.includeReddit);
  const [busy, setBusy] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);

  // Derived from subscribed state, so the labels move with the toggles instead
  // of describing whatever the lanes were when this screen last rendered.
  const lanes = requestFor({ session, twitter, includeTwitter, includeReddit });
  // "Bookmarks queued", not "bookmarks in the deck": the mixer caps the lane, so
  // the file's size is the honest number to put on a button.
  const bookmarks = lanes.twitter ? (twitter?.bookmarks?.entries.length ?? 0) : 0;
  const mixing = lanes.reddit !== "off" && bookmarks > 0;
  const nothingOn = lanes.reddit === "off" && bookmarks === 0;
  const xLabel = bookmarks > 0 ? `${bookmarks.toLocaleString()} bookmarks` : "X";
  const primaryLabel = nothingOn
    ? "Turn a source on"
    : mixing
      ? `Shuffle Reddit + ${xLabel}`
      : bookmarks > 0
        ? `Shuffle ${xLabel}`
        : session
          ? `Shuffle u/${session.username}`
          : "Try a sample shuffle";

  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    setStandalone(
      media.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    );
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    // The event is single-use: once the prompt has been shown, Chrome won't
    // fire it again, so clear it and treat the install as done.
    const onInstalled = () => {
      setInstallEvent(null);
      setStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function play(request?: Parameters<typeof refreshDeck>[0]) {
    setBusy(true);
    useFlick.getState().setError(null);
    try {
      await refreshDeck(request);
    } catch (err) {
      useFlick.getState().setError(err instanceof Error ? err.message : "Could not load a feed.");
      useFlick.getState().setScreen("home");
    } finally {
      setBusy(false);
    }
  }

  if (!ageOk) {
    return (
      <main className="grain flex min-h-dvh flex-col justify-end bg-bg px-6 pb-safe pt-safe">
        <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-end pb-10">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted">18+ player</p>
          <h1 className="mt-3 text-5xl font-semibold tracking-tight text-fg">Flick</h1>
          <p className="mt-4 max-w-sm text-base leading-normal text-muted">
            Full-screen Reddit saves and your X bookmarks, shuffled into one deck. Sound on. No
            blur, no feed filters.
          </p>
          <Button size="lg" className="mt-8 w-full" onClick={acceptAge}>
            I am 18 or older
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="grain flex min-h-dvh flex-col bg-bg px-6 pt-safe pb-safe">
      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="flex-1 pt-12">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted">
            Saved-post player
          </p>
          <h1 className="mt-4 text-6xl font-semibold tracking-tight text-fg">Flick</h1>
          <p className="mt-4 max-w-sm text-lg leading-snug text-muted">
            Your saved Reddit posts and your X bookmarks, mixed into one swipeable deck.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-muted">
            <li className="flex items-center gap-3">
              <Layers className="size-4 shrink-0 text-fg" />
              One player for both: X clips play with the same seek, mute and skip rules.
            </li>
            <li className="flex items-center gap-3">
              <Volume2 className="size-4 shrink-0 text-fg" />
              Sound enabled. Videos play unmuted.
            </li>
            <li className="flex items-center gap-3">
              <span className="inline-block size-4 shrink-0 rounded-full bg-danger/70" />
              NSFW is shown. Nothing is blurred.
            </li>
            <li className="flex items-center gap-3">
              <Smartphone className="size-4 shrink-0 text-fg" />
              Install to your home screen for a full-screen app.
            </li>
          </ul>
        </div>

        <div className="mt-6 flex flex-col gap-3 pb-8">
          <SourceChips />

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <Button
            size="lg"
            className="w-full"
            disabled={busy || nothingOn}
            onClick={() => void play()}
          >
            {busy ? "Loading…" : primaryLabel}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="w-full"
            disabled={busy || lanes.reddit === "off"}
            onClick={() => void play({ reddit: "demo", twitter: false })}
          >
            {busy ? "Loading…" : "Just the Reddit mix"}
          </Button>
          <Button size="md" variant="ghost" className="w-full" onClick={() => setScreen("connect")}>
            {session ? "Sources and sign-in" : "Set up Reddit and X"}
          </Button>
          {installEvent && !standalone ? (
            <Button
              size="md"
              variant="ghost"
              className="w-full"
              onClick={() => {
                const event = installEvent;
                setInstallEvent(null);
                void event.prompt();
              }}
            >
              Install Flick
            </Button>
          ) : !standalone ? (
            // iOS Safari never fires beforeinstallprompt, and desktop Chrome
            // only fires it once the app is installable — so always give the
            // manual route rather than showing nothing at all.
            <p className="px-1 text-center text-xs leading-relaxed text-subtle">
              Add it to your home screen:{" "}
              <span className="text-fg">Share → Add to Home Screen</span> on iPhone, or the install
              icon in the address bar on desktop.
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
