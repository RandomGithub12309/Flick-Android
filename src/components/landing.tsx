import { useEffect, useState } from "react";
import { Smartphone, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { redditDemoFeed } from "@/lib/reddit/functions";
import { loadAllSaved } from "@/lib/reddit/load-saved";
import { shuffleInPlace } from "@/lib/utils";
import { useFlick } from "@/store/flick";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function Landing() {
  const ageOk = useFlick((s) => s.ageOk);
  const acceptAge = useFlick((s) => s.acceptAge);
  const setScreen = useFlick((s) => s.setScreen);
  const setPosts = useFlick((s) => s.setPosts);
  const setError = useFlick((s) => s.setError);
  const session = useFlick((s) => s.session);
  const error = useFlick((s) => s.error);
  const [busy, setBusy] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);

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

  async function playDemo() {
    setBusy(true);
    setError(null);
    useFlick.getState().setLoading("Shuffling a live Reddit mix…");
    try {
      const posts = await redditDemoFeed();
      setPosts(shuffleInPlace(posts), "demo");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load a sample feed.");
      setScreen("home");
    } finally {
      setBusy(false);
    }
  }

  async function playSaved() {
    if (!session) {
      setScreen("connect");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const posts = await loadAllSaved(session);
      setPosts(shuffleInPlace(posts), "saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load saved posts.");
      setScreen("connect");
    } finally {
      setBusy(false);
    }
  }

  if (!ageOk) {
    return (
      <main className="grain flex min-h-dvh flex-col justify-end bg-bg px-6 pb-safe pt-safe">
        <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-end pb-10">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted">
            18+ player
          </p>
          <h1 className="mt-3 text-5xl font-semibold tracking-tight text-fg">
            Flick
          </h1>
          <p className="mt-4 max-w-sm text-base leading-normal text-muted">
            Full-screen Reddit saves. Sound on. No blur, no feed filters.
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
          <h1 className="mt-4 text-6xl font-semibold tracking-tight text-fg">
            Flick
          </h1>
          <p className="mt-4 max-w-sm text-lg leading-snug text-muted">
            Sign in, shuffle every saved post, swipe like TikTok.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-muted">
            <li className="flex items-center gap-3">
              <Volume2 className="size-4 text-fg" />
              Sound enabled. Videos play unmuted.
            </li>
            <li className="flex items-center gap-3">
              <span className="inline-block size-4 rounded-full bg-danger/70" />
              NSFW is shown. Nothing is blurred.
            </li>
            <li className="flex items-center gap-3">
              <Smartphone className="size-4 text-fg" />
              Install to your home screen for a full-screen app.
            </li>
          </ul>
        </div>

        {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}

        <div className="flex flex-col gap-3 pb-8">
          <Button size="lg" className="w-full" disabled={busy} onClick={() => void playSaved()}>
            {session ? `Shuffle u/${session.username}` : "Sign in with Reddit"}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="w-full"
            disabled={busy}
            onClick={() => void playDemo()}
          >
            {busy ? "Loading…" : "Try a sample shuffle"}
          </Button>
          {session ? (
            <Button
              size="md"
              variant="ghost"
              className="w-full"
              onClick={() => setScreen("connect")}
            >
              Use a different account
            </Button>
          ) : null}
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
              <span className="text-fg">
                Share → Add to Home Screen
              </span>{" "}
              on iPhone, or the install icon in the address bar on desktop.
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
