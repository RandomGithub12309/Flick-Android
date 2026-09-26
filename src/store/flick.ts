  posts: FlickPost[];
  index: number;
  muted: boolean;
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
  loadingLabel: string;
  loadingCount: number;
  error: string | null;
  prev: () => void;
  reroll: () => void;
  toggleMuted: () => void;
  setRedditRedirectUri: (uri: string) => void;
  signOut: () => void;
};

      posts: [],
      index: 0,
      muted: false,
      redditRedirectUri: "",
      loadingLabel: "",
      loadingCount: 0,
      error: null,
        set({ index: next });
      },
      toggleMuted: () => set({ muted: !get().muted }),
      setRedditRedirectUri: (uri) => set({ redditRedirectUri: uri.trim() }),
      signOut: () =>
        set({
          session: null,
        ageOk: state.ageOk,
        session: state.session,
        muted: state.muted,
        redditRedirectUri: state.redditRedirectUri,
      }),
    },
  ),
