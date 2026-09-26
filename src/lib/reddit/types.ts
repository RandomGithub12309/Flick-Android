export type MediaKind = "video" | "image" | "gallery" | "text" | "link";

export type FlickImage = {
  url: string;
  width?: number;
  height?: number;
};

export type FlickVideo = {
  url: string;
  audioUrl?: string;
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
