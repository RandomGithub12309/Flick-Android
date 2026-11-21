import { useEffect, useState } from "react";
import { Download, Layers, Play, Smartphone, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SourceChips } from "@/components/source-chips";
import { SubredditSearch } from "@/components/subreddit-search";
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
  const twitterSession = useFlick((s) => s.twitterSession);
  const savedPornhub = useFlick((s) => s.savedPornhub);
  const feedPlatform = useFlick((s) => s.feedPlatform);
  const setFeedPlatform = useFlick((s) => s.setFeedPlatform);
  const setPosts = useFlick((s) => s.setPosts);
  const cachedPosts = useFlick((s) => s.posts);
  const error = useFlick((s) => s.error);
  const [busy, setBusy] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(() => isNative());
  const [update, setUpdate] = useState<AppUpdateInfo | null>(null);

  const hasPh = savedPornhub.length > 0;
  const mixParts = [
    session ? "Reddit" : "Sample",
    ...(twitterSession ? ["X"] : []),
    ...(hasPh ? ["PH"] : []),
  ];

  const primaryLabel =
    feedPlatform === "pornhub"
      ? hasPh
        ? `Shuffle Saved PH (${savedPornhub.length})`
        : "Save PH videos in Search first"
      : feedPlatform === "twitter"
        ? twitterSession
          ? `Shuffle X @${twitterSession.username || "bookmarks"}`
          : "Connect X to play"
        : feedPlatform === "reddit"
          ? session
            ? `Shuffle u/${session.username}`
            : "Try Reddit sample"
          : mixParts.length > 1
            ? `Shuffle ${mixParts.join(" + ")}`
            : session
              ? `Shuffle u/${session.username}`
              : "Try a sample shuffle";

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
            Full-screen Reddit, X &amp; Pornhub saves, shuffled into one deck. Sound on. No blur, no feed filters.
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
        <div className="flex-1 pt-8">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted">
            Saved-post player
          </p>
          <h1 className="mt-2 text-5xl font-semibold tracking-tight text-fg">Flick</h1>
          <p className="mt-2 max-w-sm text-base leading-snug text-muted">
            Your saved Reddit, X &amp; Pornhub videos in one swipeable, full-screen deck.
          </p>

          <div className="mt-5">
            <SubredditSearch
              compact
              onSelectSubreddit={(subreddit, sort) =>
                void play({ reddit: "subreddit", subreddit, sort })
              }
              onPlayPornhub={(phPosts, startIndex) =>
                setPosts(phPosts, "pornhub", null, null, startIndex)
              }
            />
          </div>

          {!session ? (
            <ul className="mt-6 space-y-2.5 text-xs text-muted">
              <li className="flex items-center gap-2.5">
                <Layers className="size-3.5 shrink-0 text-fg" />
                Tap to pause, hold for 2x, double-tap to seek, swipe to advance.
              </li>
              <li className="flex items-center gap-2.5">
                <Volume2 className="size-3.5 shrink-0 text-fg" />
                Sound enabled. Videos play unmuted.
              </li>
              {!standalone ? (
                <li className="flex items-center gap-2.5">
                  <Smartphone className="size-3.5 shrink-0 text-fg" />
                  Install to your home screen for a full-screen app.
                </li>
              ) : null}
            </ul>
          ) : null}
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

          <div
            role="group"
            aria-label="Deck source"
            className="grid grid-cols-4 gap-1 rounded-xl bg-surface-2 p-1 shadow-[var(--shadow-border)]"
          >
            {(
              [
                { id: "mix", label: "Mix" },
                { id: "reddit", label: "Reddit" },
                { id: "twitter", label: "X" },
                { id: "pornhub", label: hasPh ? `PH (${savedPornhub.length})` : "PH" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFeedPlatform(opt.id)}
                className={`rounded-lg py-2 text-xs font-semibold transition ${
                  feedPlatform === opt.id
                    ? "bg-fg text-bg"
                    : "text-muted hover:text-fg"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <SourceChips />

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          {cachedPosts.length > 0 ? (
            <Button
              size="lg"
              variant="secondary"
              className="w-full gap-2"
              disabled={busy}
              onClick={() => setScreen("feed")}
            >
              <Play className="size-4" />
              Resume ({cachedPosts.length})
            </Button>
          ) : null}

          <Button
            size="lg"
            className="w-full"
            disabled={busy || (feedPlatform === "pornhub" && !hasPh)}
            onClick={() => {
              if (feedPlatform === "twitter" && !twitterSession) {
                setScreen("connect");
                return;
              }
              void play();
            }}
          >
            {busy ? "Loading…" : primaryLabel}
          </Button>
          {session && feedPlatform !== "twitter" && feedPlatform !== "pornhub" ? (
            <Button
              size="lg"
              variant="secondary"
              className="w-full"
              disabled={busy}
              onClick={() => void play({ platform: "reddit", reddit: "demo" })}
            >
              {busy ? "Loading…" : "Play the sample mix"}
            </Button>
          ) : null}
          <Button size="md" variant="ghost" className="w-full" onClick={() => setScreen("connect")}>
            Sources &amp; filters
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
