import assert from "node:assert/strict";
import test from "node:test";
import {
  parseBookmarksTimeline,
  parseTweetDetailComments,
  parseTweetResult,
  parseTwitterCookies,
} from "./parse.ts";

test("parseTwitterCookies parses raw Cookie header and separate tokens", () => {
  assert.deepEqual(
    parseTwitterCookies("guest_id=v1; auth_token=abc123; ct0=xyz789; lang=en"),
    { authToken: "abc123", ct0: "xyz789" },
  );
  assert.deepEqual(parseTwitterCookies("abc123", "xyz789"), {
    authToken: "abc123",
    ct0: "xyz789",
  });
  assert.equal(parseTwitterCookies("guest_id=v1"), null);
});

test("parseTweetResult picks highest bitrate mp4 and sets audio flag", () => {
  const post = parseTweetResult({
    __typename: "Tweet",
    rest_id: "1890001",
    core: {
      user_results: {
        result: {
          core: { screen_name: "nasa" },
        },
      },
    },
    legacy: {
      id_str: "1890001",
      full_text: "Rocket launch clip https://t.co/abc123",
      created_at: "Fri Oct 16 12:00:00 +0000 2026",
      favorite_count: 4200,
      possibly_sensitive: false,
      extended_entities: {
        media: [
          {
            type: "video",
            media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/1/img/thumb.jpg",
            original_info: { width: 1080, height: 1920 },
            video_info: {
              duration_millis: 15500,
              variants: [
                { content_type: "application/x-mpegURL", url: "https://video.twimg.com/pl.m3u8" },
                { content_type: "video/mp4", bitrate: 256000, url: "https://video.twimg.com/lowest.mp4" },
                { content_type: "video/mp4", bitrate: 632000, url: "https://video.twimg.com/mid.mp4" },
                { content_type: "video/mp4", bitrate: 2176000, url: "https://video.twimg.com/hd.mp4" },
              ],
            },
          },
        ],
      },
    },
  });

  assert.ok(post);
  assert.equal(post.platform, "twitter");
  assert.equal(post.kind, "video");
  assert.equal(post.author, "nasa");
  assert.equal(post.title, "Rocket launch clip");
  assert.equal(post.video?.url, "https://video.twimg.com/hd.mp4");
  assert.equal(post.video?.fallbackUrl, "https://video.twimg.com/mid.mp4");
  assert.deepEqual(post.video?.fallbackUrls, [
    "https://video.twimg.com/mid.mp4",
    "https://video.twimg.com/lowest.mp4",
  ]);
  assert.equal(post.video?.hasAudio, true);
  assert.equal(post.video?.duration, 15.5);
  assert.equal(post.permalink, "https://x.com/nasa/status/1890001");
});

test("parseTweetResult handles animated_gif without audio and multi-photo galleries", () => {
  const gif = parseTweetResult({
    rest_id: "200",
    core: { user_results: { result: { legacy: { screen_name: "catbot" } } } },
    legacy: {
      full_text: "Looping gif",
      extended_entities: {
        media: [
          {
            type: "animated_gif",
            media_url_https: "https://pbs.twimg.com/tweet_video_thumb/gif.jpg",
            original_info: { width: 480, height: 480 },
            video_info: {
              variants: [{ content_type: "video/mp4", bitrate: 0, url: "https://video.twimg.com/gif.mp4" }],
            },
          },
        ],
      },
    },
  });
  assert.equal(gif?.kind, "video");
  assert.equal(gif?.video?.hasAudio, false);

  const gallery = parseTweetResult({
    rest_id: "201",
    core: { user_results: { result: { legacy: { screen_name: "photos" } } } },
    legacy: {
      full_text: "Two pics",
      extended_entities: {
        media: [
          { type: "photo", media_url_https: "https://pbs.twimg.com/media/1.jpg", original_info: { width: 800, height: 600 } },
          { type: "photo", media_url_https: "https://pbs.twimg.com/media/2.jpg", original_info: { width: 800, height: 600 } },
        ],
      },
    },
  });
  assert.equal(gallery?.kind, "gallery");
  assert.equal(gallery?.gallery?.length, 2);
});

test("parseBookmarksTimeline extracts posts and bottom cursor", () => {
  const page = parseBookmarksTimeline({
    data: {
      bookmark_timeline_v2: {
        timeline: {
          instructions: [
            {
              type: "TimelineAddEntries",
              entries: [
                {
                  entryId: "tweet-1",
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: {
                          rest_id: "1",
                          core: { user_results: { result: { legacy: { screen_name: "alice" } } } },
                          legacy: {
                            full_text: "Saved pic",
                            extended_entities: {
                              media: [{ type: "photo", media_url_https: "https://pbs.twimg.com/1.jpg" }],
                            },
                          },
                        },
                      },
                    },
                  },
                },
                {
                  entryId: "cursor-bottom-0",
                  content: { cursorType: "Bottom", value: "CURSOR_NEXT" },
                },
              ],
            },
          ],
        },
      },
    },
  });

  assert.equal(page.posts.length, 1);
  assert.equal(page.posts[0]?.id, "1");
  assert.equal(page.cursor, "CURSOR_NEXT");
});

test("parseTweetDetailComments extracts replies and excludes focal tweet", () => {
  const comments = parseTweetDetailComments(
    {
      data: {
        threaded_conversation_with_injections_v2: {
          instructions: [
            {
              entries: [
                {
                  entryId: "tweet-10",
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: {
                          rest_id: "10",
                          core: { user_results: { result: { legacy: { screen_name: "op" } } } },
                          legacy: { full_text: "Original post", favorite_count: 100 },
                        },
                      },
                    },
                  },
                },
                {
                  entryId: "conversationthread-11",
                  content: {
                    items: [
                      {
                        item: {
                          itemContent: {
                            tweet_results: {
                              result: {
                                rest_id: "11",
                                core: { user_results: { result: { legacy: { screen_name: "bob" } } } },
                                legacy: { full_text: "Great video!", favorite_count: 12 },
                              },
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    },
    "10",
  );

  assert.equal(comments.length, 1);
  assert.equal(comments[0]?.author, "bob");
  assert.equal(comments[0]?.body, "Great video!");
});
