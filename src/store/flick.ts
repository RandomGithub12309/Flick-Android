import { create } from "zustand";
import { persist } from "zustand/middleware";
import { normalizeHandle } from "@/lib/twitter/parse";
import { orderDeck } from "@/lib/feed/mix";
import type { FlickOrigin, FlickPost, RedditSession } from "@/lib/reddit/types";
import type { TwitterAccount } from "@/lib/twitter/types";

export type Screen = "home" | "connect" | "loading" | "feed";
/**
 * Which Reddit feed produced the deck, or `"twitter"` when X was the only lane
 * that answered. Whether the deck is a mix is not encoded here: it is read off
 * the posts (`feedOrigins`), because that is the one thing that cannot disagree
 * with what is actually on screen.
 */
export type FeedSource = "saved" | "demo" | "twitter";

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
  /** The X account mixed into the deck, or null when only Reddit is pulled. */
  twitter: TwitterAccount | null;
  /** Off means the X account stays configured but sits out the next shuffle. */
  includeTwitter: boolean;
  /** Off means the deck is the X account alone — no Reddit lane is fetched. */
  includeReddit: boolean;
  /**
   * Ceiling on how much of the deck X may take, handed to the mixer.
   * 0.5 (the default) keeps neither host above half; 1 keeps every post of
   * both and lets the spread alone decide the rhythm.
   */
  twitterShare: number;
  posts: FlickPost[];
  /** Hosts present in `posts`, for the header and the slide badge. */
  feedOrigins: FlickOrigin[];
  index: number;
  muted: boolean;
  loadingLabel: string;
  loadingCount: number;
  error: string | null;
  /**
   * A lane that half-worked: shown over the feed instead of blocking it, since
   * a shuffle that is missing its X lane is still a shuffle worth watching.
   */
  notice: string | null;
  acceptAge: () => void;
  setScreen: (screen: Screen) => void;
  setSession: (session: RedditSession | null) => void;
  setError: (error: string | null) => void;
  setNotice: (notice: string | null) => void;
  setLoading: (label: string, count?: number) => void;
  setPosts: (posts: FlickPost[], source: FeedSource) => void;
  setRedditRedirectUri: (uri: string) => void;
  setTwitter: (account: TwitterAccount | null) => void;
  /** X's own spelling of the handle, once a fetch has resolved it. */
  setTwitterHandle: (handle: string) => void;
  setIncludeTwitter: (value: boolean) => void;
  setIncludeReddit: (value: boolean) => void;
  setTwitterShare: (value: number) => void;
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
      twitter: null,
      includeTwitter: true,
      includeReddit: true,
      twitterShare: 0.5,
      posts: [],
      feedOrigins: [],
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
        // Ordering is the store's job, not the loader's: whatever mix of hosts a
        // caller hands over comes out spread, and a single-host deck stays the
        // plain shuffle it always was.
        const deck = orderDeck(posts, { maxShare: get().twitterShare });
        set({
          posts: deck,
          feedOrigins: deck.length > 0 ? originSet(deck) : [],
          source,
          index: 0,
          screen: deck.length > 0 ? "feed" : "home",
          error:
            deck.length === 0
              ? "Nothing to play. Save a video on Reddit, or point Flick at an X account that posts them."
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
      setTwitter: (account) =>
        set({
          twitter: account
            ? { handle: normalizeHandle(account.handle), bearerToken: account.bearerToken.trim() }
            : null,
        }),
      setTwitterHandle: (handle) => {
        const { twitter } = get();
        const normalized = normalizeHandle(handle);
        if (!twitter || !normalized || twitter.handle === normalized) return;
        set({ twitter: { ...twitter, handle: normalized } });
      },
      setIncludeTwitter: (value) => set({ includeTwitter: value }),
      setIncludeReddit: (value) => set({ includeReddit: value }),
      setTwitterShare: (value) =>
        set({ twitterShare: Math.min(1, Math.max(0.1, Number.isFinite(value) ? value : 0.5)) }),
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
          // The X account is independent of the Reddit session and survives
          // signing out — it costs nothing to keep, and losing it would mean
          // retyping a token to watch the same deck again.
          session: null,
          posts: [],
          feedOrigins: [],
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
        twitter: state.twitter,
        includeTwitter: state.includeTwitter,
        includeReddit: state.includeReddit,
        twitterShare: state.twitterShare,
      }),
    },
  ),
);

function originSet(posts: FlickPost[]): FlickOrigin[] {
  const found = new Set<FlickOrigin>();
  for (const post of posts) found.add(post.origin ?? "reddit");
  return [...found];
}
