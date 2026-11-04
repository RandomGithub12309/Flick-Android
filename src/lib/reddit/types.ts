export type MediaKind = "video" | "image" | "gallery" | "text" | "link";

/**
 * Which host a post was pulled from.
 *
 * `FlickPost` is Flick's universal post shape, not a Reddit DTO: the X lane is
 * normalised into it so one slide and one player handle every source. New
 * hosts add a tag here and a parser that fills the same fields in.
 */
export type FlickOrigin = "reddit" | "twitter";

export type FlickImage = {
  url: string;
  width?: number;
  height?: number;
};

export type FlickVideo = {
  url: string;
  /**
   * What to play if {@link url} never loads — Reddit's own copy of a redgifs
   * clip, kept for networks where the redgifs CDN is blocked or the clip has
   * gone since the listing was fetched.
   */
  fallbackUrl?: string;
  /**
   * Audio track that lives beside the video, for hosts that split the two
   * (v.redd.it). Redgifs ships sound inside the mp4, so this stays unset there.
   */
  audioUrl?: string;
  /**
   * Every audio URL Reddit might be serving for this video, most likely first.
   * Reddit has renamed its audio files more than once, so the player walks the
   * list until one loads instead of guessing a single name.
   *
   * These belong to {@link url} — a v.redd.it upload ships video and audio as
   * separate files. They say nothing about {@link fallbackUrl}; see
   * {@link fallbackAudioUrls}.
   */
  audioUrls?: string[];
  /**
   * Audio that belongs to {@link fallbackUrl} rather than to {@link url}.
   *
   * A redgifs clip muxes its sound into the mp4, so it needs no sidecar, while
   * the host's own copy kept as a fallback is usually a video-only Reddit
   * upload. Without this the fallback plays silently the moment redgifs is
   * unreachable — the exact case the fallback exists to cover.
   */
  fallbackAudioUrls?: string[];
  width: number;
  height: number;
  duration?: number;
  hasAudio: boolean;
};

export type FlickPost = {
  id: string;
  name: string;
  title: string;
  subreddit: string;
  author: string;
  permalink: string;
  sourceUrl?: string;
  /**
   * Redgifs clip this post is really showing, when the raw listing mentions one
   * (link posts, embeds, crosspost parents, "sauce in the title" reposts).
   * Reddit's own copy of a redgifs clip is muted, so this wins at playback time.
   */
  redgifsId?: string;
  nsfw: boolean;
  score: number;
  createdUtc: number;
  kind: MediaKind;
  video?: FlickVideo;
  image?: FlickImage;
  gallery?: FlickImage[];
  text?: string;
  thumbnail?: string;
  domain?: string;
  /**
   * Where this post came from. Unset means Reddit — that is where every post
   * in Flick started, and the X lane stamps itself explicitly. The slide chrome
   * (badge, share link) and the mixer both read this, so a post parsed from
   * either host has to carry its own origin rather than relying on which
   * loader returned it.
   */
  origin?: FlickOrigin;
  /**
   * Handle of the X account a Twitter-sourced post came from, without the `@`.
   * Reddit posts carry `subreddit` for the same slot in the badge.
   */
  account?: string;
  /**
   * Plays X reports for the clip. Reddit has no equivalent, so its `score`
   * (upvotes) is what the badge shows; a mixed deck shows each host's own
   * popularity signal rather than a meaningless common one.
   */
  views?: number;
};

export type RedditSession = {
  username: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  clientId: string;
};

export type SavedPage = {
  posts: FlickPost[];
  after: string | null;
  username: string;
};
