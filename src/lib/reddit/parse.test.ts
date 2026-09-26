import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseRedditPost,
  redgifsIdFromMediaUrl,
  redgifsIdFromPost,
  redgifsIdFromUrl,
} from "./parse.ts";
import type { FlickPost } from "./types.ts";

/**
 * Reddit splits every v.redd.it upload into a video file and a separate audio
 * file, and has renamed that audio file at least twice (DASH_audio.mp4 →
 * DASH_AUDIO_128.mp4, and now CMAF_AUDIO_128.mp4). These tests pin the
 * candidate list, because a wrong guess is exactly what a silent video is.
 *
 * Reddit also keeps a *muted* copy of most redgifs clips, so a redgifs id must
 * survive parsing on every post shape that can carry one — the server swaps
 * Reddit's copy out for it.
 */

function listing(data: Record<string, unknown>): unknown {
  return {
    kind: "t3",
    data: {
      id: "abc123",
      name: "t3_abc123",
      title: "a title",
      subreddit: "Unexpected",
      author: "someone",
      permalink: "/r/Unexpected/comments/abc123/a_title/",
      score: 12,
      created_utc: 1_700_000_000,
      ...data,
    },
  };
}

function redditVideo(fallbackUrl: string, extra: Record<string, unknown> = {}) {
  return {
    reddit_video: {
      fallback_url: fallbackUrl,
      width: 720,
      height: 1280,
      duration: 12,
      ...extra,
    },
  };
}

describe("reddit video audio tracks", () => {
  it("finds the CMAF audio file served beside a CMAF video", () => {
    const post = parseRedditPost(
      listing({
        url: "https://v.redd.it/abc123xyz/CMAF_720.mp4",
        secure_media: redditVideo("https://v.redd.it/abc123xyz/CMAF_720.mp4?source=fallback", {
          has_audio: true,
        }),
      }),
    );

    assert.equal(post?.video?.hasAudio, true);
    assert.equal(post?.video?.audioUrl, "https://v.redd.it/abc123xyz/CMAF_AUDIO_128.mp4");
    assert.deepEqual(post?.video?.audioUrls, [
      "https://v.redd.it/abc123xyz/CMAF_AUDIO_128.mp4",
      "https://v.redd.it/abc123xyz/CMAF_AUDIO_64.mp4",
      // Signed CDN copies of the same clip are addressed by plain media id.
      "https://v.redd.it/abc123xyz/DASH_AUDIO_128.mp4",
      "https://v.redd.it/abc123xyz/DASH_AUDIO_64.mp4",
      "https://v.redd.it/abc123xyz/DASH_audio.mp4",
    ]);
    assert.equal(post?.video?.url, "https://v.redd.it/abc123xyz/CMAF_720.mp4?source=fallback");
  });

  it("keeps the older DASH names on the fallback chain", () => {
    const post = parseRedditPost(
      listing({
        secure_media: redditVideo("https://v.redd.it/dash123/DASH_1080.mp4?source=fallback", {
          has_audio: true,
        }),
      }),
    );

    const urls = post?.video?.audioUrls ?? [];
    assert.equal(urls[0], "https://v.redd.it/dash123/DASH_AUDIO_128.mp4");
    assert.ok(urls.includes("https://v.redd.it/dash123/DASH_audio.mp4"));
  });

  it("adds v.redd.it audio paths for signed CDN urls that can't be rewritten", () => {
    const post = parseRedditPost(
      listing({
        secure_media: redditVideo(
          "https://packaged-media.redd.it/signed123/pb/mp4/CMAF_480.mp4?m=abc&amp;s=def",
          { has_audio: true },
        ),
      }),
    );

    assert.ok(post?.video?.audioUrls?.includes("https://v.redd.it/signed123/CMAF_AUDIO_128.mp4"));
  });

  it("still tries for audio when Reddit omits has_audio", () => {
    const post = parseRedditPost(
      listing({
        secure_media: redditVideo("https://v.redd.it/noflag1/CMAF_720.mp4?source=fallback"),
      }),
    );

    assert.equal(post?.video?.hasAudio, true);
    assert.equal(post?.video?.audioUrl, "https://v.redd.it/noflag1/CMAF_AUDIO_128.mp4");
  });

  it("asks for no audio on videos Reddit says are silent or are gifs", () => {
    const silent = parseRedditPost(
      listing({
        secure_media: redditVideo("https://v.redd.it/silent1/CMAF_720.mp4?source=fallback", {
          has_audio: false,
        }),
      }),
    );
    assert.equal(silent?.video?.hasAudio, false);
    assert.equal(silent?.video?.audioUrl, undefined);
    assert.equal(silent?.video?.audioUrls, undefined);

    const gif = parseRedditPost(
      listing({
        secure_media: redditVideo("https://v.redd.it/gif123/CMAF_720.mp4?source=fallback", {
          has_audio: true,
          is_gif: true,
        }),
      }),
    );
    assert.equal(gif?.video?.hasAudio, false);
    assert.equal(gif?.video?.audioUrl, undefined);
  });
});

describe("redgifs ids", () => {
  it("reads ids out of the url shapes Reddit links to", () => {
    assert.equal(
      redgifsIdFromUrl("https://www.redgifs.com/watch/fancyyellowduck"),
      "fancyyellowduck",
    );
    assert.equal(redgifsIdFromUrl("https://redgifs.com/ifr/fancyyellowduck"), "fancyyellowduck");
    assert.equal(
      redgifsIdFromUrl("https://v3.redgifs.com/watch/fancyyellowduck#rel=user"),
      "fancyyellowduck",
    );
    assert.equal(redgifsIdFromUrl("https://www.reddit.com/r/x/comments/abc/title/"), undefined);
    assert.equal(redgifsIdFromUrl("https://i.imgur.com/abc.gif"), undefined);
  });

  it("takes the id from the post url on a redgifs link post", () => {
    const post = parseRedditPost(
      listing({
        url: "https://www.redgifs.com/watch/fancyyellowduck",
        domain: "redgifs.com",
      }),
    );

    assert.equal(post?.redgifsId, "fancyyellowduck");
    assert.equal(post && redgifsIdFromPost(post), "fancyyellowduck");
  });

  /**
   * The regression this guards: Reddit mints a muted `reddit_video_preview` for
   * many redgifs links, which used to win outright because the post already had
   * a video and no redgifs lookup was attempted.
   */
  it("keeps the id on a post Reddit mirrored as a muted preview video", () => {
    const post = parseRedditPost(
      listing({
        url: "https://www.redgifs.com/watch/sneakyblueotter",
        domain: "redgifs.com",
        preview: {
          images: [
            { source: { url: "https://external-preview.redd.it/x.jpg", width: 480, height: 854 } },
          ],
          reddit_video_preview: {
            fallback_url: "https://v.redd.it/preview9/DASH_480.mp4?source=fallback",
            width: 480,
            height: 854,
            has_audio: false,
          },
        },
      }),
    );

    assert.equal(post?.kind, "video");
    assert.equal(post?.video?.hasAudio, false);
    assert.equal(post?.redgifsId, "sneakyblueotter");
  });

  it("finds the id inside an oembed iframe when the url is not a redgifs link", () => {
    const post = parseRedditPost(
      listing({
        url: "https://v.redd.it/mirror1/CMAF_720.mp4",
        domain: "v.redd.it",
        media: {
          type: "redgifs",
          oembed: {
            provider_url: "https://www.redgifs.com/",
            html: '<iframe src="https://www.redgifs.com/ifr/happyorangefrog" width="640"></iframe>',
          },
        },
        secure_media: {
          ...redditVideo("https://v.redd.it/mirror1/CMAF_720.mp4?source=fallback", {
            has_audio: true,
          }),
          oembed: {
            html: '<iframe src="https://www.redgifs.com/ifr/happyorangefrog"></iframe>',
          },
        },
      }),
    );

    assert.equal(post?.redgifsId, "happyorangefrog");
  });

  it("finds the id on the crosspost parent when the repost only mirrors the clip", () => {
    const parent = {
      url: "https://redgifs.com/watch/quietpurplemoose",
      domain: "redgifs.com",
      title: "source",
      preview: {
        images: [
          {
            source: { url: "https://external-preview.redd.it/moose.jpg", width: 480, height: 854 },
          },
        ],
      },
    };
    const post = parseRedditPost(
      listing({
        url: "https://v.redd.it/repost7/CMAF_720.mp4",
        domain: "v.redd.it",
        crosspost_parent_list: [parent],
        // The parent has no reddit_video, so the repost falls back to its own
        // preview — exactly the shape that used to lose the redgifs clip.
        preview: {
          reddit_video_preview: {
            fallback_url: "https://v.redd.it/repost7/DASH_480.mp4?source=fallback",
            has_audio: false,
          },
        },
      }),
    );

    assert.equal(post?.redgifsId, "quietpurplemoose");
  });

  it("finds a 'sauce in the title' id", () => {
    const post = parseRedditPost(
      listing({
        url: "https://v.redd.it/sauce22/CMAF_720.mp4",
        title: "wait for it [source: https://redgifs.com/watch/lazyyellowzebra]",
        secure_media: redditVideo("https://v.redd.it/sauce22/CMAF_720.mp4?source=fallback", {
          has_audio: false,
        }),
      }),
    );

    assert.equal(post?.redgifsId, "lazyyellowzebra");
  });

  it("leaves non-redgifs posts alone", () => {
    const post = parseRedditPost(
      listing({
        url: "https://v.redd.it/plain1/CMAF_720.mp4",
        secure_media: redditVideo("https://v.redd.it/plain1/CMAF_720.mp4?source=fallback", {
          has_audio: true,
        }),
      }),
    );

    assert.equal(post?.redgifsId, undefined);
    assert.equal(post && redgifsIdFromPost(post), undefined);
  });

  it("reads the clip id out of a redgifs media file name", () => {
    // The media CDN names each file after the clip, CamelCased, with a variant
    // suffix — so a thumbnail or a `-silent` link still identifies the clip.
    assert.equal(
      redgifsIdFromMediaUrl("https://media.redgifs.com/ZealousGreenShark.mp4"),
      "zealousgreenshark",
    );
    assert.equal(
      redgifsIdFromMediaUrl("https://media.redgifs.com/ZealousGreenShark-mobile.mp4"),
      "zealousgreenshark",
    );
    assert.equal(
      redgifsIdFromMediaUrl("https://media.redgifs.com/ZealousGreenShark-poster.jpg"),
      "zealousgreenshark",
    );
    assert.equal(redgifsIdFromMediaUrl("https://i.imgur.com/abc.jpg"), undefined);
    assert.equal(redgifsIdFromMediaUrl("https://www.redgifs.com/watch/abc"), undefined);
  });

  /**
   * A post can *be* a redgifs clip file rather than a watch link. Reddit has no
   * copy of those at all, so before this they were treated as plain links and
   * never played.
   */
  it("treats a post that links a redgifs clip file as that video", () => {
    const post = parseRedditPost(
      listing({
        url: "https://media.redgifs.com/ZealousGreenShark-mobile.mp4",
        domain: "media.redgifs.com",
        preview: {
          images: [{ source: { url: "https://media.redgifs.com/ZealousGreenShark-mobile.jpg" } }],
        },
      }),
    );

    assert.equal(post?.kind, "video");
    // Through the proxy: the CDN 403s a bare browser fetch.
    assert.equal(post?.video?.url, "/api/redgifs/zealousgreenshark");
    assert.equal(post?.video?.hasAudio, true);
    assert.equal(post?.redgifsId, "zealousgreenshark");
  });

  it("knows the -silent cut of a clip file has no sound", () => {
    const post = parseRedditPost(
      listing({
        url: "https://media.redgifs.com/QuietPurpleMoose-silent.mp4",
        domain: "media.redgifs.com",
      }),
    );

    assert.equal(post?.kind, "video");
    assert.equal(post?.video?.hasAudio, false);
    assert.equal(post?.redgifsId, "quietpurplemoose");
  });

  it("prefers an id parsed off the payload over one guesses from the title", () => {
    const post = {
      ...(parseRedditPost(
        listing({
          url: "https://www.redgifs.com/watch/realfrog",
          domain: "redgifs.com",
          title: "credit: redgifs.com/watch/otherfrog",
        }),
      ) as FlickPost),
      redgifsId: "fromembed",
    };

    assert.equal(redgifsIdFromPost(post), "fromembed");
  });
});
