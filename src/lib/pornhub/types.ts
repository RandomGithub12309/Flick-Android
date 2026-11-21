export type PornhubSort = "relevance" | "mv" | "tr" | "mr";

export type PornhubSearchResult = {
  viewkey: string;
  title: string;
  thumbnail: string;
  duration: string;
  durationSeconds?: number;
  views?: string;
  rating?: string;
  author: string;
  authorUrl?: string;
  permalink: string;
};

export type PornhubMediaDefinition = {
  format?: string;
  quality?: string | number | (string | number)[];
  videoUrl?: string;
  defaultQuality?: boolean;
};
