import {
  createTwitterBookmark,
  deleteTwitterBookmark,
  fetchTwitterBookmarksPage,
  fetchTwitterTweetComments,
  fetchTwitterUserMedia,
} from "./twitter.native";
import type { TwitterSession } from "./types";
import type { FlickPost, RedditComment } from "@/lib/reddit/types";

const MAX_BOOKMARK_PAGES = 10;
const FAST_START_PAGES = 3;

export async function loadTwitterBookmarks(
  session: TwitterSession,
  options?: {
    onCount?: (count: number) => void;
    onMore?: (posts: FlickPost[]) => void;
  },
): Promise<FlickPost[]> {
  const initial: FlickPost[] = [];
  let cursor: string | null = null;
  let pagesFetched = 0;

  for (let i = 0; i < FAST_START_PAGES; i++) {
    const page = await fetchTwitterBookmarksPage(session, cursor, 40);
    pagesFetched += 1;
    initial.push(...page.posts);
    options?.onCount?.(initial.length);
    cursor = page.cursor;
    if (!cursor || initial.length >= 25) break;
  }

  if (cursor) {
    void (async () => {
      let nextCursor: string | null = cursor;
      for (let i = pagesFetched; i < MAX_BOOKMARK_PAGES && nextCursor; i++) {
        try {
          const page = await fetchTwitterBookmarksPage(session, nextCursor, 40);
          if (page.posts.length > 0) {
            options?.onMore?.(page.posts);
          }
          if (!page.cursor || page.cursor === nextCursor) break;
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
