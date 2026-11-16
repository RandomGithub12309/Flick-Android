import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mediaKeyOf, orderDeck } from "@/lib/feed/mix";
import type { FlickPost, RedditSession, SubredditSort } from "@/lib/reddit/types";

export type Screen = "home" | "connect" | "loading" | "feed";
export type FeedSource = "saved" | "demo" | "subreddit";
export type MediaFilter = "all" | "video";

export const DEFAULT_SUBREDDITS = [
  "Unexpected",
  "nextfuckinglevel",
  "Damnthatsinteresting",
  "nsfw",
  "NSFW_GIF",
];

type FlickState = {
  ageOk: boolean;
  screen: Screen;
  source: FeedSource;
  activeSubreddit: string | null;
  subredditSort: SubredditSort;
  session: RedditSession | null;
  redditClientId: string;
  redditRedirectUri: string;
  customSubreddits: string[];
  mediaFilter: MediaFilter;
  showNsfw: boolean;
  autoAdvance: boolean;
  posts: FlickPost[];
  index: number;
  muted: boolean;
  loadingLabel: string;
  loadingCount: number;
  error: string | null;
  notice: string | null;
  acceptAge: () => void;
  setScreen: (screen: Screen) => void;
  setSession: (session: RedditSession | null) => void;
  setRedditClientId: (clientId: string) => void;
  setRedditRedirectUri: (uri: string) => void;
  setCustomSubreddits: (subs: string[]) => void;
  setMediaFilter: (filter: MediaFilter) => void;
  setShowNsfw: (show: boolean) => void;
  setAutoAdvance: (auto: boolean) => void;
  setSubredditSort: (sort: SubredditSort) => void;
  setError: (error: string | null) => void;
  setNotice: (notice: string | null) => void;
  setLoading: (label: string, count?: number) => void;
  setPosts: (posts: FlickPost[], source: FeedSource, subreddit?: string | null) => void;
  appendPosts: (more: FlickPost[]) => void;
  removePost: (id: string) => void;
  insertPostAt: (post: FlickPost, atIndex: number) => void;
  setIndex: (index: number) => void;
  next: () => void;
  prev: () => void;
  reroll: () => void;
  toggleMuted: () => void;
  signOut: () => void;
};

const DECK_CACHE_KEY = "flick.deck.v1";

type CachedDeck = {
  posts: FlickPost[];
  index: number;
  source: FeedSource;
  activeSubreddit: string | null;
};

function readCachedDeck(): CachedDeck {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(DECK_CACHE_KEY) : null;
    if (!raw) return { posts: [], index: 0, source: "demo", activeSubreddit: null };
    const parsed = JSON.parse(raw) as Partial<CachedDeck>;
    const posts = Array.isArray(parsed.posts) ? parsed.posts : [];
    const index =
      typeof parsed.index === "number" && posts.length > 0
        ? Math.min(Math.max(0, parsed.index), posts.length - 1)
        : 0;
    const source: FeedSource =
      parsed.source === "saved" || parsed.source === "subreddit" ? parsed.source : "demo";
    return {
      posts,
      index,
      source,
      activeSubreddit: typeof parsed.activeSubreddit === "string" ? parsed.activeSubreddit : null,
    };
  } catch {
    return { posts: [], index: 0, source: "demo", activeSubreddit: null };
  }
}

let deckSaveTimer: number | null = null;

function scheduleDeckSave(state: FlickState) {
  if (typeof window === "undefined") return;
  if (deckSaveTimer !== null) window.clearTimeout(deckSaveTimer);
  deckSaveTimer = window.setTimeout(() => {
    deckSaveTimer = null;
    try {
      const capped = state.posts.slice(0, 60);
      const payload: CachedDeck = {
        posts: capped,
        index: capped.length > 0 ? Math.min(state.index, capped.length - 1) : 0,
        source: state.source,
        activeSubreddit: state.activeSubreddit,
      };
      window.localStorage.setItem(DECK_CACHE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors
    }
  }, 800);
}

const initialDeck = readCachedDeck();

export const useFlick = create<FlickState>()(
  persist(
    (set, get) => ({
      ageOk: false,
      redditClientId: "",
      redditRedirectUri: "",
      customSubreddits: DEFAULT_SUBREDDITS,
      mediaFilter: "all",
      showNsfw: true,
      autoAdvance: false,
      screen: "home",
      source: initialDeck.source,
      activeSubreddit: initialDeck.activeSubreddit,
      subredditSort: "hot",
      session: null,
      posts: initialDeck.posts,
      index: initialDeck.index,
      muted: false,
      loadingLabel: "",
      loadingCount: 0,
      error: null,
      notice: null,
      acceptAge: () => set({ ageOk: true }),
      setScreen: (screen) => set({ screen, error: null }),
      setSession: (session) => set({ session }),
      setRedditClientId: (clientId) => set({ redditClientId: clientId.trim() }),
      setRedditRedirectUri: (uri) => set({ redditRedirectUri: uri.trim() }),
      setCustomSubreddits: (subs) =>
        set({
          customSubreddits: subs.length > 0 ? subs : DEFAULT_SUBREDDITS,
        }),
      setMediaFilter: (mediaFilter) => set({ mediaFilter }),
      setShowNsfw: (showNsfw) => set({ showNsfw }),
      setAutoAdvance: (autoAdvance) => set({ autoAdvance }),
      setSubredditSort: (subredditSort) => set({ subredditSort }),
      setError: (error) => set({ error }),
      setNotice: (notice) => set({ notice }),
      setLoading: (label, count = 0) =>
        set({ screen: "loading", loadingLabel: label, loadingCount: count, error: null }),
      setPosts: (posts, source, subreddit = null) => {
        const deck = source === "subreddit" ? posts : orderDeck(posts);
        set({
          posts: deck,
          source,
          activeSubreddit: source === "subreddit" ? subreddit : null,
          index: 0,
          screen: deck.length > 0 ? "feed" : "home",
          error:
            deck.length === 0
              ? "Nothing to play. Try adjusting your filters or saving a video."
              : null,
        });
      },
      appendPosts: (more) => {
        if (more.length === 0) return;
        const current = get().posts;
        const seenIds = new Set(current.map((p) => p.id));
        const seenKeys = new Set(current.map(mediaKeyOf));
        const fresh = orderDeck(more).filter((p) => {
          const key = mediaKeyOf(p);
          if (seenIds.has(p.id) || seenKeys.has(key)) return false;
          seenIds.add(p.id);
          seenKeys.add(key);
          return true;
        });
        if (fresh.length > 0) {
          set({ posts: [...current, ...fresh] });
        }
      },
      removePost: (id) => {
        const { posts, index } = get();
        const nextPosts = posts.filter((p) => p.id !== id);
        if (nextPosts.length === 0) {
          set({
            posts: [],
            index: 0,
            screen: "home",
            error: "No playable posts left in this deck.",
          });
          return;
        }
        set({
          posts: nextPosts,
          index: Math.min(index, nextPosts.length - 1),
        });
      },
      insertPostAt: (post, atIndex) => {
        const { posts } = get();
        if (posts.some((p) => p.id === post.id)) return;
        const clamped = Math.max(0, Math.min(atIndex, posts.length));
        const nextPosts = [...posts];
        nextPosts.splice(clamped, 0, post);
        set({ posts: nextPosts, index: clamped, screen: "feed" });
      },
      setIndex: (index) => {
        const { posts } = get();
        if (posts.length === 0) return;
        const next = ((index % posts.length) + posts.length) % posts.length;
        set({ index: next });
      },
      next: () => {
        const { index, posts } = get();
        if (posts.length === 0) return;
        set({ index: (index + 1) % posts.length });
      },
      prev: () => {
        const { index, posts } = get();
        if (posts.length === 0) return;
        set({ index: (index - 1 + posts.length) % posts.length });
      },
      reroll: () => {
        const { posts, index } = get();
        if (posts.length < 2) return;
        let next = Math.floor(Math.random() * posts.length);
        if (next === index) next = (next + 1) % posts.length;
        set({ index: next });
      },
      toggleMuted: () => set({ muted: !get().muted }),
      signOut: () =>
        set({
          session: null,
          posts: [],
          index: 0,
          screen: "home",
          source: "demo",
          activeSubreddit: null,
          error: null,
          notice: null,
        }),
    }),
    {
      name: "flick.v1",
      partialize: (state) => ({
        ageOk: state.ageOk,
        session: state.session,
        muted: state.muted,
        autoAdvance: state.autoAdvance,
        subredditSort: state.subredditSort,
        redditClientId: state.redditClientId,
        redditRedirectUri: state.redditRedirectUri,
        customSubreddits: state.customSubreddits,
        mediaFilter: state.mediaFilter,
        showNsfw: state.showNsfw,
      }),
    },
  ),
);

useFlick.subscribe((state, prev) => {
  if (
    state.posts !== prev.posts ||
    state.index !== prev.index ||
    state.source !== prev.source ||
    state.activeSubreddit !== prev.activeSubreddit
  ) {
    scheduleDeckSave(state);
  }
});
