export type MediaKind = "video" | "image" | "gallery" | "text" | "link";

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
   */
  audioUrls?: string[];
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
