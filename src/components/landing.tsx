import { useEffect, useState } from "react";
import { Download, Layers, Smartphone, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SourceChips } from "@/components/source-chips";
import { refreshDeck } from "@/lib/feed/load";
import { checkForAppUpdate, openUpdateDownload, type AppUpdateInfo } from "@/lib/reddit/app-update";
import { isNative } from "@/lib/reddit/native-oauth";
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
  const [busy, setBusy] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(() => isNative());
  const [update, setUpdate] = useState<AppUpdateInfo | null>(null);

  const primaryLabel = session ? `Shuffle u/${session.username}` : "Try a sample shuffle";

  useEffect(() => {
    if (isNative()) {
      setStandalone(true);
      void checkForAppUpdate().then((info) => {
        if (info) setUpdate(info);
      });
      return;
    }
    const media = window.matchMedia("(display-mode: standalone)");
    setStandalone(
      media.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    );
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
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
            Full-screen Reddit saves, shuffled into one deck. Sound on. No blur, no feed filters.
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
            Your saved Reddit posts in one swipeable, full-screen deck.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-muted">
            <li className="flex items-center gap-3">
              <Layers className="size-4 shrink-0 text-fg" />
              Tap to pause, swipe to advance, and auto-skip broken clips.
            </li>
            <li className="flex items-center gap-3">
              <Volume2 className="size-4 shrink-0 text-fg" />
              Sound enabled. Videos play unmuted.
            </li>
            <li className="flex items-center gap-3">
              <span className="inline-block size-4 shrink-0 rounded-full bg-danger/70" />
              NSFW is shown by default (configurable in settings).
            </li>
            {!standalone ? (
              <li className="flex items-center gap-3">
                <Smartphone className="size-4 shrink-0 text-fg" />
                Install to your home screen for a full-screen app.
              </li>
            ) : null}
          </ul>
        </div>

        <div className="mt-6 flex flex-col gap-3 pb-8">
          {update ? (
            <Button
              size="md"
              variant="secondary"
              className="w-full gap-2"
              onClick={() => void openUpdateDownload(update.downloadUrl)}
            >
              <Download className="size-4" />
              Update available ({update.versionName}) — Install
            </Button>
          ) : null}

          <SourceChips />

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <Button size="lg" className="w-full" disabled={busy} onClick={() => void play()}>
            {busy ? "Loading…" : primaryLabel}
          </Button>
          {session ? (
            <Button
              size="lg"
              variant="secondary"
              className="w-full"
              disabled={busy}
              onClick={() => void play({ reddit: "demo" })}
            >
              {busy ? "Loading…" : "Play the sample mix"}
            </Button>
          ) : null}
          <Button size="md" variant="ghost" className="w-full" onClick={() => setScreen("connect")}>
            {session ? "Reddit & filters" : "Connect Reddit & filters"}
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
