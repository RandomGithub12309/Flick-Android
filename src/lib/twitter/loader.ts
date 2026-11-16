import {
  createTwitterBookmark,
  deleteTwitterBookmark,
  fetchTwitterBookmarksPage,
  fetchTwitterTweetComments,
  fetchTwitterUserMedia,
} from "./twitter.native";
import type { TwitterSession } from "./types";
import type { FlickPost, RedditComment } from "@/lib/reddit/types";

const MAX_BOOKMARK_PAGES = 6;
const FAST_START_PAGES = 1;

export async function loadTwitterBookmarks(
  session: TwitterSession,
  options?: {
    onCount?: (count: number) => void;
    onMore?: (posts: FlickPost[]) => void;
  },
): Promise<FlickPost[]> {
  const initial: FlickPost[] = [];
  let cursor: string | null = null;

  for (let i = 0; i < FAST_START_PAGES; i++) {
    const page = await fetchTwitterBookmarksPage(session, cursor, 40);
    initial.push(...page.posts);
    options?.onCount?.(initial.length);
    cursor = page.cursor;
    if (!cursor || page.posts.length === 0) break;
  }

  if (cursor) {
    void (async () => {
      let nextCursor: string | null = cursor;
      for (let i = FAST_START_PAGES; i < MAX_BOOKMARK_PAGES && nextCursor; i++) {
        try {
          const page = await fetchTwitterBookmarksPage(session, nextCursor, 40);
          if (page.posts.length === 0) break;
          options?.onMore?.(page.posts);
          nextCursor = page.cursor;
        } catch {
          break;
        }
      }
    })();
  }

  return initial;
}

export async function loadTwitterUserFeed(
  session: TwitterSession,
  screenName: string,
): Promise<FlickPost[]> {
  const page = await fetchTwitterUserMedia(session, screenName, 40);
  return page.posts;
}

export async function loadTwitterComments(
  session: TwitterSession,
  tweetId: string,
): Promise<RedditComment[]> {
  return fetchTwitterTweetComments(session, tweetId);
}

export async function saveTwitterPost(
  session: TwitterSession,
  tweetId: string,
): Promise<void> {
  await createTwitterBookmark(session, tweetId);
}

export async function unsaveTwitterPost(
  session: TwitterSession,
  tweetId: string,
): Promise<void> {
  await deleteTwitterBookmark(session, tweetId);
}
