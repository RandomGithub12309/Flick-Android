import { create } from "zustand";
import { persist } from "zustand/middleware";
import { orderDeck } from "@/lib/feed/mix";
import type { FlickPost, RedditSession } from "@/lib/reddit/types";

export type Screen = "home" | "connect" | "loading" | "feed";
export type FeedSource = "saved" | "demo";

type FlickState = {
  ageOk: boolean;
  screen: Screen;
  source: FeedSource;
  session: RedditSession | null;
  /**
   * Overrides the redirect URI sent to Reddit. Empty means "use Flick's own".
   */
  redditRedirectUri: string;
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
  setError: (error: string | null) => void;
  setNotice: (notice: string | null) => void;
  setLoading: (label: string, count?: number) => void;
  setPosts: (posts: FlickPost[], source: FeedSource) => void;
  setRedditRedirectUri: (uri: string) => void;
  setIndex: (index: number) => void;
  next: () => void;
  prev: () => void;
  reroll: () => void;
  toggleMuted: () => void;
  signOut: () => void;
};

export const useFlick = create<FlickState>()(
  persist(
    (set, get) => ({
      ageOk: false,
      redditRedirectUri: "",
      screen: "home",
      source: "demo",
      session: null,
      posts: [],
      index: 0,
      muted: false,
      loadingLabel: "",
      loadingCount: 0,
      error: null,
      notice: null,
      acceptAge: () => set({ ageOk: true }),
      setScreen: (screen) => set({ screen, error: null }),
      setSession: (session) => set({ session }),
      setError: (error) => set({ error }),
      setNotice: (notice) => set({ notice }),
      setLoading: (label, count = 0) =>
        set({ screen: "loading", loadingLabel: label, loadingCount: count, error: null }),
      setPosts: (posts, source) => {
        const deck = orderDeck(posts);
        set({
          posts: deck,
          source,
          index: 0,
          screen: deck.length > 0 ? "feed" : "home",
          error: deck.length === 0 ? "Nothing to play. Save a video on Reddit first." : null,
        });
      },
      setRedditRedirectUri: (uri) => set({ redditRedirectUri: uri.trim() }),
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
        redditRedirectUri: state.redditRedirectUri,
      }),
    },
  ),
);
