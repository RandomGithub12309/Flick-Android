import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mediaKeyOf, orderDeck } from "@/lib/feed/mix";
import type { FlickPost, RedditSession, SubredditSort } from "@/lib/reddit/types";
import type { TwitterSession } from "@/lib/twitter/types";

export type Screen = "home" | "connect" | "loading" | "feed";
export type FeedPlatform = "mix" | "reddit" | "twitter" | "pornhub";
export type FeedSource =
  | "saved"
  | "demo"
  | "subreddit"
  | "twitter"
  | "twitter-user"
  | "pornhub"
  | "pornhub-saved"
  | "mix";
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
  feedPlatform: FeedPlatform;
  source: FeedSource;
  activeSubreddit: string | null;
  activeTwitterUser: string | null;
  subredditSort: SubredditSort;
  session: RedditSession | null;
  twitterSession: TwitterSession | null;
  savedPornhub: FlickPost[];
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
  setFeedPlatform: (platform: FeedPlatform) => void;
  setSession: (session: RedditSession | null) => void;
  setTwitterSession: (session: TwitterSession | null) => void;
  savePornhubPost: (post: FlickPost) => void;
  unsavePornhubPost: (idOrKey: string) => void;
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
  setPosts: (
    posts: FlickPost[],
    source: FeedSource,
    subreddit?: string | null,
    twitterUser?: string | null,
    startIndex?: number,
  ) => void;
  appendPosts: (more: FlickPost[]) => void;
  removePost: (id: string) => void;
  insertPostAt: (post: FlickPost, atIndex: number) => void;
  setIndex: (index: number) => void;
  next: () => void;
  prev: () => void;
  reroll: () => void;
  toggleMuted: () => void;
  rebindLocalProxyOrigin: (origin: string) => void;
  signOut: () => void;
  signOutTwitter: () => void;
};

const DECK_CACHE_KEY = "flick.deck.v1";

type CachedDeck = {
  posts: FlickPost[];
  index: number;
  source: FeedSource;
  activeSubreddit: string | null;
  activeTwitterUser: string | null;
};

function readCachedDeck(): CachedDeck {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(DECK_CACHE_KEY) : null;
    if (!raw) {
      return { posts: [], index: 0, source: "demo", activeSubreddit: null, activeTwitterUser: null };
    }
    const parsed = JSON.parse(raw) as Partial<CachedDeck>;
    const posts = Array.isArray(parsed.posts) ? parsed.posts : [];
    const index =
      typeof parsed.index === "number" && posts.length > 0
        ? Math.min(Math.max(0, parsed.index), posts.length - 1)
        : 0;
    const validSources: FeedSource[] = [
      "saved",
      "demo",
      "subreddit",
      "twitter",
      "twitter-user",
      "pornhub",
      "pornhub-saved",
      "mix",
    ];
    const source: FeedSource =
      parsed.source && validSources.includes(parsed.source) ? parsed.source : "demo";
    return {
      posts,
      index,
      source,
      activeSubreddit: typeof parsed.activeSubreddit === "string" ? parsed.activeSubreddit : null,
      activeTwitterUser:
        typeof parsed.activeTwitterUser === "string" ? parsed.activeTwitterUser : null,
    };
  } catch {
    return { posts: [], index: 0, source: "demo", activeSubreddit: null, activeTwitterUser: null };
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
        activeTwitterUser: state.activeTwitterUser,
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
      feedPlatform: "mix",
      redditClientId: "",
      redditRedirectUri: "",
      customSubreddits: DEFAULT_SUBREDDITS,
      mediaFilter: "all",
      showNsfw: true,
      autoAdvance: false,
      screen: "home",
      source: initialDeck.source,
      activeSubreddit: initialDeck.activeSubreddit,
      activeTwitterUser: initialDeck.activeTwitterUser,
      subredditSort: "hot",
      session: null,
      twitterSession: null,
      savedPornhub: [],
      posts: initialDeck.posts,
      index: initialDeck.index,
      muted: false,
      loadingLabel: "",
      loadingCount: 0,
      error: null,
      notice: null,
      acceptAge: () => set({ ageOk: true }),
      setScreen: (screen) => set({ screen, error: null }),
      setFeedPlatform: (feedPlatform) => set({ feedPlatform }),
      setSession: (session) => set({ session }),
      setTwitterSession: (twitterSession) => set({ twitterSession }),
      savePornhubPost: (post) => {
        const key = post.pornhubKey || post.id.replace(/^ph_/, "");
        if (!key) return;
        const clean: FlickPost = {
          ...post,
          id: `ph_${key}`,
          name: `ph_${key}`,
          platform: "pornhub",
          pornhubKey: key,
          kind: "video",
          // Strip ephemeral signed CDN URLs so playback always resolves fresh via pornhubKey.
          video: undefined,
        };
        const current = get().savedPornhub;
        if (current.some((p) => p.pornhubKey === key || p.id === clean.id)) return;
        set({ savedPornhub: [clean, ...current] });
      },
      unsavePornhubPost: (idOrKey) => {
        const cleanKey = idOrKey.replace(/^ph_/, "");
        set({
          savedPornhub: get().savedPornhub.filter(
            (p) => p.id !== idOrKey && p.pornhubKey !== cleanKey && p.id !== `ph_${cleanKey}`,
          ),
        });
      },
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
      setPosts: (posts, source, subreddit = null, twitterUser = null, startIndex = 0) => {
        const keepOrder =
          source === "subreddit" || source === "twitter-user" || source === "pornhub";
        const deck = keepOrder ? posts : orderDeck(posts);
        const clampedIndex =
          deck.length > 0 ? Math.min(Math.max(0, startIndex), deck.length - 1) : 0;
        set({
          posts: deck,
          source,
          activeSubreddit: source === "subreddit" ? subreddit : null,
          activeTwitterUser: source === "twitter-user" ? twitterUser : null,
          index: clampedIndex,
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
      rebindLocalProxyOrigin: (origin) => {
        const cleanOrigin = origin.replace(/\/+$/, "");
        if (!cleanOrigin) return;
        const rewrite = (url: string | undefined): string | undefined => {
          if (!url) return url;
          return url.replace(/^http:\/\/127\.0\.0\.1:\d+(?=\/api\/)/, cleanOrigin);
        };
        const { posts } = get();
        let changed = false;
        const nextPosts = posts.map((post) => {
          if (!post.video) return post;
          const nextUrl = rewrite(post.video.url) ?? post.video.url;
          const nextFallback = rewrite(post.video.fallbackUrl);
          const nextFallbacks = post.video.fallbackUrls?.map((u) => rewrite(u) ?? u);
          const fallbacksChanged =
            Boolean(nextFallbacks) &&
            nextFallbacks!.some((u, i) => u !== post.video?.fallbackUrls?.[i]);
          if (
            nextUrl === post.video.url &&
            nextFallback === post.video.fallbackUrl &&
            !fallbacksChanged
          ) {
            return post;
          }
          changed = true;
          return {
            ...post,
            video: {
              ...post.video,
              url: nextUrl,
              fallbackUrl: nextFallback,
              fallbackUrls: nextFallbacks,
            },
          };
        });
        if (changed) set({ posts: nextPosts });
      },
      signOut: () =>
        set({
          session: null,
          posts: [],
          index: 0,
          screen: "home",
          source: "demo",
          activeSubreddit: null,
          activeTwitterUser: null,
          error: null,
          notice: null,
        }),
      signOutTwitter: () =>
        set({
          twitterSession: null,
          posts: [],
          index: 0,
          screen: "home",
          source: "demo",
          activeSubreddit: null,
          activeTwitterUser: null,
          error: null,
          notice: null,
        }),
    }),
    {
      name: "flick.v1",
      partialize: (state) => ({
        ageOk: state.ageOk,
        feedPlatform: state.feedPlatform,
        session: state.session,
        twitterSession: state.twitterSession,
        savedPornhub: state.savedPornhub,
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
    state.activeSubreddit !== prev.activeSubreddit ||
    state.activeTwitterUser !== prev.activeTwitterUser
  ) {
    scheduleDeckSave(state);
  }
});
