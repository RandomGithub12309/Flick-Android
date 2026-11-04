import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isHandle,
  normalizeHandle,
  parseSyndicationTimeline,
  parseTweet,
  parseUserTweets,
  pickMp4Variant,
  userIdFromLookup,
} from "./parse.ts";
import type { FlickPost, FlickVideo } from "../reddit/types.ts";

/**
 * X → `FlickPost` is the seam that lets one player serve both hosts, so these
 * tests are what guards "the same video player for both": if a tweet parses
 * into the shape the slide already understands, nothing downstream has to know.
 *
 * The two payload shapes are pinned on purpose — the API returns v2 (`text`,
 * `public_metrics`, media in `includes`), the public embed feed returns v1.1
 * (`full_text`, `favorite_count`, media inline) — because a parser that only
 * handles one would show a deck with no X posts in it and no error.
 */

function variants(...entries: Record<string, unknown>[]) {
  return entries;
}

const HD =
  "https://video.twimg.com/ext_tw_video/1557437992389722112/pu/vid/1280x720/abcDEF.mp4?tag=14";
const SD =
  "https://video.twimg.com/ext_tw_video/1557437992389722112/pu/vid/640x360/zzz999.mp4?tag=14";

describe("variant selection — the file the player will actually load", () => {
  it("takes the highest-bitrate mp4, not the first or the manifest", () => {
    const picked = pickMp4Variant(
      variants(
        {
          content_type: "application/x-mpegURL",
          url: "https://video.twimg.com/a/pl/x.m3u8?tag=14",
        },
        { bit_rate: 256000, content_type: "video/mp4", url: SD },
        { bit_rate: 2176000, content_type: "video/mp4", url: HD },
      ),
    );
    assert.equal(picked?.url, HD);
    assert.equal(picked?.width, 1280);
    assert.equal(picked?.height, 720);
  });

  it("reads the embed transport's `bitrate` spelling", () => {
    const picked = pickMp4Variant(
      variants({ bitrate: 862000, url: SD }, { bitrate: 2176000, url: HD }),
    );
    assert.equal(picked?.url, HD);
  });

  it("still picks a variant that states no bitrate, and prefers one that does", () => {
    const only = pickMp4Variant(variants({ content_type: "video/mp4", url: SD }));
    assert.equal(only?.url, SD);
    const mixed = pickMp4Variant(
      variants(
        { content_type: "video/mp4", url: SD },
        { bit_rate: 1, content_type: "video/mp4", url: HD },
      ),
    );
    assert.equal(mixed?.url, HD);
  });

  it("refuses a manifest-only media object, which the player could never start", () => {
    assert.equal(
      pickMp4Variant(variants({ content_type: "application/x-mpegURL", url: "https://x/a.m3u8" })),
      undefined,
    );
    assert.equal(
      pickMp4Variant(variants({ type: "hls", url: "https://video.twimg.com/a/pl/x.m3u8" })),
      undefined,
    );
  });
});

function v2Media(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    media_key: "13_1",
    type: "video",
    url: undefined,
    preview_image_url: "https://pbs.twimg.com/media/EYeX7ak.jpg",
    width: 1080,
    height: 1920,
    duration_ms: 12_500,
    variants: [
      { bit_rate: 256000, content_type: "video/mp4", url: SD },
      { bit_rate: 2176000, content_type: "video/mp4", url: HD },
    ],
    public_metrics: { view_count: 4_200_000 },
    ...extra,
  };
}

function v2Tweet(data: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "1263145271946551300",
    text: "look at this https://t.co/pV53mvjAVT",
    created_at: "2024-05-01T12:00:00.000Z",
    public_metrics: { retweet_count: 4, reply_count: 1, like_count: 90, quote_count: 2 },
    author_id: "u1",
    attachments: { media_keys: ["13_1"] },
    ...data,
  };
}

describe("v2 payload (official API)", () => {
  it("produces a video post the Reddit slide can play untouched", () => {
    const post = parseTweet(v2Tweet(), {
      mediaById: new Map([["13_1", v2Media()]]),
      referencedById: new Map(),
      account: "nasa",
    })! as FlickPost;
    assert.equal(post.kind, "video");
    assert.equal(post.origin, "twitter");
    assert.equal(post.account, "nasa");
    assert.equal(post.video?.url, HD);
    assert.equal(post.video?.width, 1080);
    assert.equal(post.video?.height, 1920);
    // Reddit's fragmented uploads need a separate audio file; X muxes sound into
    // the mp4, and a sidecar here would play the clip's audio twice.
    assert.equal(post.video?.hasAudio, true);
    assert.equal(post.video?.audioUrl, undefined);
    assert.equal(post.video?.audioUrls, undefined);
    assert.equal(post.video?.duration, 12.5);
    assert.equal(post.permalink, "https://x.com/nasa/status/1263145271946551300");
    assert.equal(post.score, 90);
    assert.equal(post.views, 4_200_000);
    assert.equal(post.image?.url, "https://pbs.twimg.com/media/EYeX7ak.jpg");
    assert.equal(post.title, "look at this");
    assert.equal(post.subreddit, "");
    assert.equal(post.createdUtc, Math.floor(Date.parse("2024-05-01T12:00:00.000Z") / 1000));
  });

  it("prefixes the id so a tweet and a post can't collide in the store", () => {
    const post = parseTweet(v2Tweet(), { mediaById: new Map([["13_1", v2Media()]]) })! as FlickPost;
    assert.equal(post.id, "x_1263145271946551300");
  });

  it("marks a sensitive post NSFW and keeps an animated gif silent", () => {
    const post = parseTweet(v2Tweet({ possibly_sensitive: true }), {
      mediaById: new Map([["13_1", v2Media({ type: "animated_gif" })]]),
    })! as FlickPost;
    assert.equal(post.nsfw, true);
    assert.equal(post.video?.hasAudio, false);
  });

  it("keeps a photo post as an image at full size", () => {
    const post = parseTweet(v2Tweet(), {
      mediaById: new Map([
        [
          "13_1",
          {
            media_key: "13_1",
            type: "photo",
            url: "https://pbs.twimg.com/media/abc.jpg",
            width: 2048,
            height: 1365,
          },
        ],
      ]),
    })! as FlickPost;
    assert.equal(post.kind, "image");
    assert.equal(post.image?.url, "https://pbs.twimg.com/media/abc.jpg?name=orig");
    assert.equal(post.video, undefined);
  });

  it("keeps several photos as a gallery the slide already pages through", () => {
    const media = new Map<string, Record<string, unknown>>([
      ["a", { media_key: "a", type: "photo", url: "https://pbs.twimg.com/media/1.jpg" }],
      ["b", { media_key: "b", type: "photo", url: "https://pbs.twimg.com/media/2.jpg" }],
    ]);
    const post = parseTweet(v2Tweet({ attachments: { media_keys: ["a", "b"] } }), {
      mediaById: media,
    })! as FlickPost;
    assert.equal(post.kind, "gallery");
    assert.equal(post.gallery?.length, 2);
  });

  it("applies the same content bar the Reddit lane has", () => {
    // Not a moderation stance — Flick shows NSFW and blurs nothing — but the one
    // rule both hosts must share, so adding X can't open a way around it.
    const post = parseTweet(
      v2Tweet({ text: "collecting preteen stuff https://t.co/aa" }),
      { mediaById: new Map([["13_1", v2Media()]]) },
    );
    assert.equal(post, null);
  });

  it("drops a text-only post rather than filling the deck with cards", () => {
    assert.equal(
      parseTweet({ id: "9", text: "just words", created_at: "2024-05-01T12:00:00.000Z" }),
      null,
    );
  });

  it("plays a quote post's clip, from the tweet the API expanded for it", () => {
    const quoted = {
      id: "500",
      text: "the original",
      attachments: { media_keys: ["13_2"] },
    };
    const post = parseTweet(
      v2Tweet({
        text: "this is unreal",
        attachments: undefined,
        referenced_tweets: [{ id: "500", type: "quoted" }],
      }),
      {
        mediaById: new Map([["13_2", v2Media({ media_key: "13_2" })]]),
        referencedById: new Map([["500", quoted]]),
        account: "nasa",
      },
    )! as FlickPost;
    assert.equal(post.kind, "video");
    assert.equal(post.video?.url, HD);
    // The slide stays on the post the account actually made, so the link out
    // goes to the quote, not to a clip the account merely shared.
    assert.equal(post.permalink, "https://x.com/nasa/status/1263145271946551300");
    assert.equal(post.title, "this is unreal");
  });

  it("parses the expansions envelope and the page cursor", () => {
    const parsed = parseUserTweets(
      {
        data: [v2Tweet()],
        includes: { media: [v2Media()], users: [{ id: "u1", username: "NASA", name: "NASA" }] },
        meta: { result_count: 1, next_token: "abc" },
      },
      "nasa",
    );
    assert.equal(parsed.posts.length, 1);
    assert.equal(parsed.posts[0]?.account, "nasa");
    assert.equal(parsed.after, "abc");
  });

  it("survives a malformed response with no posts instead of throwing", () => {
    for (const body of [
      null,
      {},
      { data: "nope" },
      { data: [{}] },
      { includes: { media: null } },
    ]) {
      assert.doesNotThrow(() => parseUserTweets(body, "nasa"));
      assert.equal(parseUserTweets(body, "nasa").posts.length, 0);
    }
  });
});

describe("embed payload (public timeline)", () => {
  const tweet = {
    id_str: "1675187969420828672",
    full_text: "Earth from the ISS https://t.co/xyz123",
    created_at: "Tue Jul 02 14:00:00 +0000 2024",
    favorite_count: 1200,
    possibly_sensitive: false,
    user: { screen_name: "NASA", name: "NASA" },
    extended_entities: {
      media: [
        {
          type: "video",
          preview_image_url: "https://pbs.twimg.com/amplify_video_thumb/1/img/x.jpg",
          video_info: {
            duration_millis: 8775,
            variants: [
              { content_type: "application/x-mpegURL", url: "https://video.twimg.com/a/pl/x.m3u8" },
              {
                content_type: "video/mp4",
                bitrate: 632000,
                url: "https://video.twimg.com/a/pu/vid/320x568/low.mp4",
              },
              {
                content_type: "video/mp4",
                bitrate: 2176000,
                url: "https://video.twimg.com/a/pu/vid/720x1280/high.mp4",
              },
            ],
          },
        },
      ],
    },
  };

  it("reads the v1.1-shaped tweet the widget renders", () => {
    const post = parseTweet(tweet) as FlickPost;
    assert.equal(post.kind, "video");
    assert.equal(post.video?.url, "https://video.twimg.com/a/pu/vid/720x1280/high.mp4");
    assert.equal(post.video?.width, 720);
    assert.equal(post.video?.height, 1280);
    assert.equal(post.account, "nasa");
    assert.equal(post.score, 1200);
    assert.equal(post.title, "Earth from the ISS");
    assert.equal(post.permalink, "https://x.com/nasa/status/1675187969420828672");
  });

  it("pulls the tweets out of the Next.js payload, and shrugs at a page without one", () => {
    const html = `<html><head></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      { props: { pageProps: { timeline: { entries: [{ entry_id: "1", content: { tweet } }] } } } },
    )}</script></body></html>`;
    const posts = parseSyndicationTimeline(html);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.kind, "video");
    // Text-only entries are what a real profile is mostly made of.
    assert.deepEqual(parseSyndicationTimeline("<html><body>nope</body></html>"), []);
    assert.deepEqual(parseSyndicationTimeline('<script id="__NEXT_DATA__">{broken'), []);
  });

  it("skips a boost whose clip is the original post's", () => {
    const boost = parseTweet({
      id_str: "2000",
      full_text: "",
      retweeted_status: tweet,
      user: { screen_name: "NASA" },
    });
    // The quote/boost source carries the media, so this is a video — but it must
    // not pretend to be the account's own permalink.
    assert.equal((boost as FlickPost).kind, "video");
    assert.match((boost as FlickPost).permalink, /^https:\/\/x\.com\/nasa/);
  });
});

describe("handles", () => {
  it("accepts whatever form a person pastes", () => {
    assert.equal(normalizeHandle("@NASA"), "nasa");
    assert.equal(normalizeHandle(" https://x.com/NASA/with_replies "), "nasa");
    assert.equal(normalizeHandle("twitter.com/NASA?ref=1"), "nasa");
  });

  it("rejects what X cannot resolve", () => {
    assert.equal(isHandle("nasa"), true);
    assert.equal(isHandle("not a handle"), false);
    assert.equal(isHandle("way_too_long_handle_for_x"), false);
    assert.equal(isHandle(""), false);
  });

  it("reads the user lookup, including an id pasted as a handle", () => {
    assert.equal(userIdFromLookup({ data: { id: "45", username: "nasa" } }), "45");
    assert.equal(userIdFromLookup({ data: { id: undefined, username: "12" } }), "12");
    assert.equal(userIdFromLookup({ errors: [{ detail: "Not found" }] }), undefined);
  });
});

describe("duration and audio contract with the shared player", () => {
  it("reports duration in seconds like a Reddit video does", () => {
    const post = parseTweet(v2Tweet(), {
      mediaById: new Map([["13_1", v2Media({ duration_ms: 46_947 })]]),
    })! as FlickPost;
    const video = post.video as FlickVideo;
    assert.equal(video.duration, 46.9);
  });

  it("leaves the duration unknown rather than guessing, so the seek bar disables", () => {
    const post = parseTweet(v2Tweet(), {
      mediaById: new Map([["13_1", v2Media({ duration_ms: undefined })]]),
    })! as FlickPost;
    assert.equal(post.video?.duration, undefined);
  });
});
