import type { FlickPost } from "@/lib/reddit/types";

export type TwitterSession = {
  username: string;
  authToken: string;
  ct0: string;
};

export type TwitterPage = {
  posts: FlickPost[];
  cursor: string | null;
  username: string;
};
