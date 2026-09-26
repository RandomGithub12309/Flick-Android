import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { exchangeCode, fetchSavedPage, refreshGrant, streamRedgifsFile } from "./reddit.server.ts";

/**
 * Flick is a Reddit **installed app**: a public client issued with no client
 * secret. That is a real protocol contract, not a style preference — Reddit
 * issues a secret to "script"/"web app" registrations and rejects a bare
 * client id against those. These tests pin the installed-app wire format so a
 * future change can't quietly turn Flick into a script app (which would also
 * mean shipping a secret inside a client-side app).
 *
 * `fetch` is stubbed, so nothing here touches reddit.com.
 */

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const realFetch = globalThis.fetch;

type Recorded = { url: string; init: RequestInit };

let calls: Recorded[] = [];

function decodeBasic(header: string): { user: string; password: string } {
  const raw = header.replace(/^Basic\s+/i, "");
  const decoded = Buffer.from(raw, "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  return { user: decoded.slice(0, sep), password: decoded.slice(sep + 1) };
}

function stub(routes: Array<[RegExp, () => Response]>) {
  calls = [];
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    for (const [match, respond] of routes) {
      if (match.test(url)) return respond();
    }
    throw new Error(`unstubbed request: ${url}`);
  }) as typeof fetch;
}

const tokenResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  globalThis.fetch = realFetch;
  calls = [];
});

describe("reddit token exchange — installed app contract", () => {
  it("authenticates as the client id with an EMPTY password (no secret)", async () => {
    stub([
      [
        /access_token/,
        () => tokenResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
      ],
      [/\/api\/v1\/me/, () => tokenResponse({ name: "someone" })],
    ]);

    await exchangeCode({ code: "c", redirectUri: "flick://oauth", clientId: "myClientId" });

    const token = calls.find((c) => c.url === TOKEN_URL);
    assert.ok(token, "token endpoint was called");
    const auth = decodeBasic((token.init.headers as Record<string, string>).Authorization);
    assert.equal(auth.user, "myClientId", "client id is the Basic username");
    assert.equal(auth.password, "", "installed apps send NO client secret");
  });

  it("never puts a client_secret in the request body", async () => {
    stub([
      [/access_token/, () => tokenResponse({ access_token: "at", expires_in: 3600 })],
      [/\/api\/v1\/me/, () => tokenResponse({ name: "someone" })],
    ]);

    await exchangeCode({ code: "c", redirectUri: "flick://oauth", clientId: "id" });

    const token = calls.find((c) => c.url === TOKEN_URL)!;
    const body = String(token.init.body);
    assert.ok(!body.includes("client_secret"), `body leaked a secret: ${body}`);
    assert.ok(!body.includes("secret"), `body mentioned a secret: ${body}`);
  });

  it("uses the authorization_code grant and echoes the registered redirect_uri", async () => {
    stub([
      [/access_token/, () => tokenResponse({ access_token: "at", expires_in: 3600 })],
      [/\/api\/v1\/me/, () => tokenResponse({ name: "someone" })],
    ]);

    await exchangeCode({ code: "the-code", redirectUri: "flick://oauth", clientId: "id" });

    const params = new URLSearchParams(String(calls[0].init.body));
    assert.equal(params.get("grant_type"), "authorization_code");
    assert.equal(params.get("code"), "the-code");
    // Reddit rejects the exchange if this differs from the authorize request.
    assert.equal(params.get("redirect_uri"), "flick://oauth");
  });

  it("sends a descriptive User-Agent, which Reddit requires", async () => {
    stub([
      [/access_token/, () => tokenResponse({ access_token: "at", expires_in: 3600 })],
      [/\/api\/v1\/me/, () => tokenResponse({ name: "someone" })],
    ]);

    await exchangeCode({ code: "c", redirectUri: "flick://oauth", clientId: "id" });

    const headers = calls[0].init.headers as Record<string, string>;
    assert.match(headers["User-Agent"], /app\.flick\.saved/);
  });

  it("refreshes with the refresh_token grant and still sends no secret", async () => {
    stub([
      [/access_token/, () => tokenResponse({ access_token: "at2", expires_in: 3600 })],
      [/\/api\/v1\/me/, () => tokenResponse({ name: "someone" })],
    ]);

    const bundle = await refreshGrant({ refreshToken: "rt", clientId: "myClientId" });

    const token = calls.find((c) => c.url === TOKEN_URL)!;
    const params = new URLSearchParams(String(token.init.body));
    assert.equal(params.get("grant_type"), "refresh_token");
    assert.equal(params.get("refresh_token"), "rt");
    assert.ok(!params.has("client_secret"));
    assert.equal(
      decodeBasic((token.init.headers as Record<string, string>).Authorization).password,
      "",
    );
    assert.equal(bundle.accessToken, "at2");
  });

  it("resolves the username over oauth.reddit.com with a bearer token", async () => {
    stub([
      [/access_token/, () => tokenResponse({ access_token: "at", expires_in: 3600 })],
      [/\/api\/v1\/me/, () => tokenResponse({ name: "someone" })],
    ]);

    const bundle = await exchangeCode({ code: "c", redirectUri: "flick://oauth", clientId: "id" });
    assert.equal(bundle.username, "someone");

    const me = calls.find((c) => c.url.includes("/api/v1/me"))!;
    const headers = me.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer at");
  });
});

describe("reddit errors point at the installed-app requirement", () => {
  it("explains a rejected client id as an app-type problem, not a bad id", async () => {
    stub([[/access_token/, () => tokenResponse({ error: "invalid_client" }, 401)]]);

    await assert.rejects(
      () => exchangeCode({ code: "c", redirectUri: "flick://oauth", clientId: "id" }),
      (err: Error) => {
        assert.match(err.message, /installed app/);
        assert.match(err.message, /never asks for a client secret/);
        assert.doesNotMatch(err.message, /username or password/);
        return true;
      },
    );
  });

  it("tells a reused/expired code to authorize again", async () => {
    stub([[/access_token/, () => tokenResponse({ error: "invalid_grant" }, 400)]]);

    await assert.rejects(
      () => exchangeCode({ code: "c", redirectUri: "flick://oauth", clientId: "id" }),
      (err: Error) => {
        assert.match(err.message, /Authorize again/);
        assert.doesNotMatch(err.message, /username or password/);
        return true;
      },
    );
  });

  it("fails loudly when Reddit returns no access token", async () => {
    stub([[/access_token/, () => tokenResponse({ token_type: "bearer" }, 200)]]);

    await assert.rejects(
      () => exchangeCode({ code: "c", redirectUri: "flick://oauth", clientId: "id" }),
      /did not return an access token/,
    );
  });
});

/**
 * Saved listings keep Reddit's own copy of a redgifs clip — a muted
 * `reddit_video_preview` on the link post, or a mirrored v.redd.it upload — and
 * that copy used to win simply because the post already had a video. The real
 * clip (with its sound) has to win instead, and Reddit's copy stays around for
 * the clips redgifs no longer serves.
 */
function savedListing(children: Array<Record<string, unknown>>): unknown {
  return { kind: "Listing", data: { after: null, children } };
}

/**
 * `gifId` doubles as the post id on purpose: the resolver caches clips by
 * redgifs id, so each test needs its own clip to stay independent.
 */
function redgifsLinkPost(
  gifId: string,
  data: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: "t3",
    data: {
      id: `post-${gifId}`,
      name: `t3_post-${gifId}`,
      title: "sauce",
      subreddit: "NSFW_GIF",
      author: "someone",
      permalink: `/r/NSFW_GIF/comments/post-${gifId}/sauce/`,
      url: `https://www.redgifs.com/watch/${gifId}`,
      domain: "redgifs.com",
      over_18: true,
      preview: {
        reddit_video_preview: {
          fallback_url: `https://v.redd.it/${gifId}/DASH_480.mp4?source=fallback`,
          width: 480,
          height: 854,
          has_audio: false,
        },
      },
      ...data,
    },
  };
}

const redgifsRoutes = (
  gifId: string,
  clip: unknown,
  status = 200,
): Array<[RegExp, () => Response]> => [
  [/oauth\.reddit\.com\/user/, () => tokenResponse(savedListing([redgifsLinkPost(gifId)]))],
  [/api\.redgifs\.com\/v2\/auth\/temporary/, () => tokenResponse({ token: "rg-token" })],
  [/api\.redgifs\.com\/v2\/gifs\//, () => tokenResponse(clip, status)],
];

describe("redgifs clips replace Reddit's muted copy", () => {
  it("plays the redgifs hd mp4, sound included, for a mirrored preview video", async () => {
    stub(
      redgifsRoutes("sneakyblueotter", {
        gif: {
          hasAudio: true,
          width: 1080,
          height: 1920,
          duration: 6.4,
          urls: {
            hd: "https://media.redgifs.com/SneakyBlueOtter.mp4",
            sd: "https://media.redgifs.com/SneakyBlueOtter-mobile.mp4",
          },
        },
      }),
    );

    const page = await fetchSavedPage({ accessToken: "at", username: "someone" });
    const post = page.posts[0];

    assert.equal(post.kind, "video");
    // Through the proxy: the CDN 403s a bare browser fetch.
    assert.equal(post.video?.url, "/api/redgifs/sneakyblueotter");
    // Redgifs muxes sound into the mp4 — there is no separate audio file.
    assert.equal(post.video?.hasAudio, true);
    assert.equal(post.video?.audioUrl, undefined);
    assert.equal(post.video?.audioUrls, undefined);
    assert.equal(post.video?.width, 1080);
    // Reddit's copy stays on the post as the "redgifs CDN is unreachable" path.
    assert.equal(
      post.video?.fallbackUrl,
      "https://v.redd.it/sneakyblueotter/DASH_480.mp4?source=fallback",
    );
  });

  it("keeps Reddit's audio on the fallback, so a failed redgifs URL is not silent", async () => {
    // The preview here is a normal upload with its own audio track, not the
    // muted one — exactly the case where dropping the audio would leave the
    // fallback playing nothing at all.
    const withAudio = redgifsLinkPost("audiofallback", {
      preview: {
        reddit_video_preview: {
          fallback_url: "https://v.redd.it/audiofallback/DASH_480.mp4?source=fallback",
          width: 480,
          height: 854,
          has_audio: true,
        },
      },
    });
    stub([
      [/oauth\.reddit\.com\/user/, () => tokenResponse(savedListing([withAudio]))],
      [/api\.redgifs\.com\/v2\/auth\/temporary/, () => tokenResponse({ token: "rg-token" })],
      [
        /api\.redgifs\.com\/v2\/gifs\//,
        () =>
          tokenResponse({
            gif: {
              hasAudio: true,
              urls: { hd: "https://media.redgifs.com/AudioFallback.mp4" },
            },
          }),
      ],
    ]);

    const page = await fetchSavedPage({ accessToken: "at", username: "someone" });
    const video = page.posts[0].video;

    assert.equal(video?.url, "/api/redgifs/audiofallback");
    assert.equal(
      video?.fallbackUrl,
      "https://v.redd.it/audiofallback/DASH_480.mp4?source=fallback",
    );
    // The fallback is video-only on Reddit, so its sound lives in the sidecar.
    assert.ok(
      video?.fallbackAudioUrls?.length,
      "the fallback must keep an audio track, or it plays silent",
    );
    assert.match(video?.fallbackAudioUrls?.[0] ?? "", /audiofallback/);
    // The primary is the redgifs mp4, which has its own sound — a sidecar here
    // would double it.
    assert.equal(video?.audioUrls, undefined);
  });

  it("looks the clip up with a bearer token and an app User-Agent", async () => {
    stub(
      redgifsRoutes("happymagentafrog", {
        gif: { urls: { hd: "https://media.redgifs.com/HappyMagentaFrog.mp4" } },
      }),
    );

    await fetchSavedPage({ accessToken: "at", username: "someone" });

    const lookup = calls.find((c) => c.url.includes("/v2/gifs/"))!;
    const headers = lookup.init.headers as Record<string, string>;
    assert.match(headers.Authorization, /^Bearer /);
    assert.match(headers["User-Agent"], /Mozilla/);
    assert.ok(!lookup.init.method || lookup.init.method === "GET");
  });

  it("keeps Reddit's copy when redgifs no longer serves the clip", async () => {
    stub(redgifsRoutes("deletedclip", { error: "not found" }, 404));

    const page = await fetchSavedPage({ accessToken: "at", username: "someone" });
    const post = page.posts[0];

    assert.equal(post.kind, "video");
    assert.equal(post.video?.url, "https://v.redd.it/deletedclip/DASH_480.mp4?source=fallback");
    assert.equal(post.video?.fallbackUrl, undefined);
    assert.equal(post.video?.hasAudio, false);
  });

  it("retries once with a fresh token when redgifs rejects the cached one", async () => {
    stub([
      [
        /oauth\.reddit\.com\/user/,
        () => tokenResponse(savedListing([redgifsLinkPost("staletoken")])),
      ],
      [/api\.redgifs\.com\/v2\/auth\/temporary/, () => tokenResponse({ token: "fresh-token" })],
      [
        /api\.redgifs\.com\/v2\/gifs\//,
        () => {
          const attempts = calls.filter((c) => c.url.includes("/v2/gifs/"));
          if (attempts.length <= 1) return tokenResponse({ error: "unauthorized" }, 401);
          return tokenResponse({
            gif: { hasAudio: true, urls: { hd: "https://media.redgifs.com/StaleToken.mp4" } },
          });
        },
      ],
    ]);

    const page = await fetchSavedPage({ accessToken: "at", username: "someone" });

    assert.equal(page.posts[0].video?.url, "/api/redgifs/staletoken");
    const tokens = calls
      .filter((c) => c.url.includes("/v2/gifs/"))
      .map((c) => (c.init.headers as Record<string, string>).Authorization);
    assert.equal(tokens.length, 2, "one rejected lookup, one retry — no more");
    assert.notEqual(tokens[0], tokens[1], "the retry must use a newly issued token");
  });

  it("does not turn an image post that credits a clip into that clip", async () => {
    stub([
      [
        /oauth\.reddit\.com\/user/,
        () =>
          tokenResponse(
            savedListing([
              {
                kind: "t3",
                data: {
                  id: "photo-post",
                  name: "t3_photo-post",
                  title: "credit: https://redgifs.com/watch/borrowedtitle",
                  subreddit: "NSFW_GIF",
                  author: "someone",
                  permalink: "/r/NSFW_GIF/comments/photo-post/credit/",
                  url: "https://i.redd.it/photo1.jpg",
                  over_18: true,
                },
              },
            ]),
          ),
      ],
    ]);

    const page = await fetchSavedPage({ accessToken: "at", username: "someone" });
    const post = page.posts[0];

    assert.equal(post.kind, "image");
    assert.equal(post.video, undefined);
    assert.equal(
      calls.some((c) => c.url.includes("redgifs")),
      false,
    );
  });

  /**
   * The player retries a clip whose URL failed on the device, and the cache is
   * what decides whether that retry gets a genuinely new URL or the same dead
   * one back.
   */
  it("serves an unsigned clip from cache instead of asking redgifs again", async () => {
    stub(
      redgifsRoutes("cacheableclip", {
        gif: { hasAudio: true, urls: { hd: "https://media.redgifs.com/CacheableClip.mp4" } },
      }),
    );

    const first = await fetchSavedPage({ accessToken: "at", username: "someone" });
    const second = await fetchSavedPage({ accessToken: "at", username: "someone" });

    assert.equal(first.posts[0].video?.url, "/api/redgifs/cacheableclip");
    assert.equal(second.posts[0].video?.url, "/api/redgifs/cacheableclip");
    const lookups = calls.filter((c) => c.url.includes("/v2/gifs/"));
    assert.equal(lookups.length, 1, "second load should be answered from cache");
  });

  /**
   * Signed links carry an `expires` stamp, but the feed never sees one: it
   * plays the stable proxy URL, and the proxy re-resolves the direct link
   * server-side on every play. An expiring direct link must therefore surface
   * as the proxy URL, not leak through to the device.
   */
  it("serves the stable proxy url even when the direct link is expiring", async () => {
    stub(
      redgifsRoutes("expiringclip", {
        gif: {
          hasAudio: true,
          urls: {
            hd: "https://media.redgifs.com/ExpiringClip.mp4?expires=1000000000&signature=deadbeef",
          },
        },
      }),
    );

    const page = await fetchSavedPage({ accessToken: "at", username: "someone" });

    assert.equal(page.posts[0].video?.url, "/api/redgifs/expiringclip");
  });

  it("plays a post that links a redgifs clip file, upgrading it to the HD copy", async () => {
    stub([
      [
        /oauth\.reddit\.com\/user/,
        () =>
          tokenResponse(
            savedListing([
              {
                kind: "t3",
                data: {
                  id: "media-post",
                  name: "t3_media-post",
                  title: "clip file",
                  subreddit: "NSFW_GIF",
                  author: "someone",
                  permalink: "/r/NSFW_GIF/comments/media-post/clip_file/",
                  // No Reddit-side copy at all: the link *is* the clip file,
                  // and it is the `-silent` cut.
                  url: "https://media.redgifs.com/ZealousGreenShark-silent.mp4",
                  domain: "media.redgifs.com",
                  over_18: true,
                },
              },
            ]),
          ),
      ],
      [/api\.redgifs\.com\/v2\/auth\/temporary/, () => tokenResponse({ token: "rg-token" })],
      [
        /api\.redgifs\.com\/v2\/gifs\//,
        () =>
          tokenResponse({
            gif: {
              hasAudio: true,
              urls: { hd: "https://media.redgifs.com/ZealousGreenShark.mp4" },
            },
          }),
      ],
    ]);

    const page = await fetchSavedPage({ accessToken: "at", username: "someone" });
    const post = page.posts[0];

    assert.equal(post.kind, "video");
    // The HD copy with sound wins over the silent file the post linked to…
    assert.equal(post.video?.url, "/api/redgifs/zealousgreenshark");
    assert.equal(post.video?.hasAudio, true);
    // …and the linked file stays as the fallback if redgifs' API is down —
    // through the proxy as well, since the CDN 403s bare browser fetches.
    assert.equal(post.video?.fallbackUrl, "/api/redgifs/zealousgreenshark");
  });

  it("leaves a plain reddit upload alone, audio track included", async () => {
    stub([
      [
        /oauth\.reddit\.com\/user/,
        () =>
          tokenResponse(
            savedListing([
              {
                kind: "t3",
                data: {
                  id: "cat-post",
                  name: "t3_cat-post",
                  title: "a cat",
                  subreddit: "aww",
                  author: "someone",
                  permalink: "/r/aww/comments/cat-post/a_cat/",
                  url: "https://v.redd.it/cat123xyz/CMAF_720.mp4",
                  secure_media: {
                    reddit_video: {
                      fallback_url: "https://v.redd.it/cat123xyz/CMAF_720.mp4?source=fallback",
                      has_audio: true,
                      width: 720,
                      height: 1280,
                    },
                  },
                },
              },
            ]),
          ),
      ],
    ]);

    const page = await fetchSavedPage({ accessToken: "at", username: "someone" });
    const post = page.posts[0];

    assert.equal(post.redgifsId, undefined);
    assert.equal(post.video?.url, "https://v.redd.it/cat123xyz/CMAF_720.mp4?source=fallback");
    // Its sound lives next to the video, so the feed has to fetch it separately.
    assert.equal(post.video?.audioUrl, "https://v.redd.it/cat123xyz/CMAF_AUDIO_128.mp4");
    // Nothing redgifs-shaped about this post, so nothing was asked of redgifs.
    assert.equal(
      calls.some((c) => c.url.includes("redgifs")),
      false,
    );
  });
});

describe("redgifs proxy stream", () => {
  /**
   * The CDN signs clip URLs per requesting IP and validates UA/Referer, so a
   * link resolved on the server 403s in the browser. The proxy resolves and
   * fetches server-side and streams the bytes from our own origin instead.
   */
  const gifRoute = (id: string, direct: string): Array<[RegExp, () => Response]> => [
    [/api\.redgifs\.com\/v2\/auth\/temporary/, () => tokenResponse({ token: "rg-token" })],
    [
      /api\.redgifs\.com\/v2\/gifs\//,
      () => tokenResponse({ gif: { hasAudio: true, urls: { hd: direct } } }),
    ],
  ];

  it("streams bytes with the headers the CDN demands", async () => {
    stub([
      ...gifRoute("proxystreamone", "https://media.redgifs.com/ProxyStreamOne.mp4"),
      [
        /media\.redgifs\.com/,
        () =>
          new Response("full-bytes", {
            status: 200,
            headers: { "content-type": "video/mp4", "content-length": "10" },
          }),
      ],
    ]);

    const res = await streamRedgifsFile(
      "proxystreamone",
      new Request("https://flick.test/api/redgifs/proxystreamone"),
    );

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "video/mp4");
    assert.equal(res.headers.get("accept-ranges"), "bytes");
    assert.equal(await res.text(), "full-bytes");

    const cdn = calls.find((c) => c.url.includes("media.redgifs.com"))!;
    const headers = new Headers(cdn.init.headers);
    assert.match(headers.get("User-Agent") ?? "", /Chrome/);
    assert.match(headers.get("Referer") ?? "", /redgifs\.com\/watch\//);
  });

  it("forwards Range and passes 206 through for seeking", async () => {
    stub([
      ...gifRoute("proxystreamtwo", "https://media.redgifs.com/ProxyStreamTwo.mp4"),
      [
        /media\.redgifs\.com/,
        () =>
          new Response("bytes", {
            status: 206,
            headers: {
              "content-type": "video/mp4",
              "content-range": "bytes 0-4/100",
              "content-length": "5",
              "accept-ranges": "bytes",
            },
          }),
      ],
    ]);

    const res = await streamRedgifsFile(
      "proxystreamtwo",
      new Request("https://flick.test/api/redgifs/proxystreamtwo", {
        headers: { Range: "bytes=0-4" },
      }),
    );

    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), "bytes 0-4/100");
    const cdn = calls.find((c) => c.url.includes("media.redgifs.com"))!;
    assert.equal(new Headers(cdn.init.headers).get("Range"), "bytes=0-4");
  });

  it("rejects bad ids without touching the network", async () => {
    stub([]);
    const res = await streamRedgifsFile("../x", new Request("https://flick.test/api/redgifs/x"));
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0);
  });

  it("502s when the clip no longer resolves", async () => {
    stub([
      [/api\.redgifs\.com\/v2\/auth\/temporary/, () => tokenResponse({ token: "rg-token" })],
      [/api\.redgifs\.com\/v2\/gifs\//, () => tokenResponse({ error: "gone" }, 404)],
    ]);
    const res = await streamRedgifsFile(
      "proxystreamgone",
      new Request("https://flick.test/api/redgifs/proxystreamgone"),
    );
    assert.equal(res.status, 502);
  });
});
