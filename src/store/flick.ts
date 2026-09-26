import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FlickPost, RedditSession } from "@/lib/reddit/types";
import { shuffleInPlace } from "@/lib/utils";

export type Screen = "home" | "connect" | "loading" | "feed";
export type FeedSource = "saved" | "demo";

type FlickState = {
  ageOk: boolean;
  screen: Screen;
  source: FeedSource;
  session: RedditSession | null;
  /**
   * Overrides the redirect URI sent to Reddit. Empty means "use Flick's own".
   *
   * Reddit validates redirect_uri against the value registered on the app
   * *before* the person presses Allow, and a mismatch fails the grant outright.
   * Reddit only lets you edit apps you created, so anyone reusing an existing
   * installed app whose redirect URI they can't change needs to paste that
   * exact string here — otherwise there is no value Flick could send that
   * Reddit would accept.
   */
  redditRedirectUri: string;
  posts: FlickPost[];
  index: number;
  muted: boolean;
  loadingLabel: string;
  loadingCount: number;
  error: string | null;
  acceptAge: () => void;
  setScreen: (screen: Screen) => void;
  setSession: (session: RedditSession | null) => void;
  setError: (error: string | null) => void;
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
      acceptAge: () => set({ ageOk: true }),
      setScreen: (screen) => set({ screen, error: null }),
      setSession: (session) => set({ session }),
      setError: (error) => set({ error }),
      setLoading: (label, count = 0) =>
        set({ screen: "loading", loadingLabel: label, loadingCount: count, error: null }),
      setPosts: (posts, source) => {
        const shuffled = shuffleInPlace([...posts]);
        set({
          posts: shuffled,
          source,
          index: 0,
          screen: shuffled.length > 0 ? "feed" : "home",
          error:
            shuffled.length === 0
              ? "No posts to play. Save something on Reddit, then try again."
              : null,
        });
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
      setRedditRedirectUri: (uri) => set({ redditRedirectUri: uri.trim() }),
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
