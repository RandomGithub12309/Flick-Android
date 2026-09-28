import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

/**
 * The device transport, tested without a device.
 *
 * Everything Flick asks of Reddit has to survive a trip through Capacitor's
 * native HTTP plugin, and two things about that trip are easy to get wrong and
 * impossible to notice until sign-in fails on a real phone:
 *
 *   1. The plugin urlencodes an **object** body itself. Handing it an
 *      already-encoded string double-encodes, and Reddit rejects the grant.
 *   2. `User-Agent` has to arrive intact. Reddit answers the stock Android
 *      `Dalvik/…` agent with a 403, and redgifs' CDN gates on a desktop-Chrome
 *      one. This is also why the app calls the plugin directly instead of
 *      enabling its global `window.fetch` patch, which drops that header.
 *
 * `@capacitor/core` reads `globalThis.Capacitor` and `CapacitorCustomPlatform`
 * when it is first evaluated, so the bridge is stood up here and the modules
 * under test are imported afterwards, dynamically.
 */

type BridgeCall = { plugin: string; method: string; options: Record<string, any> };

const calls: BridgeCall[] = [];
let respond: (url: string) => { status: number; body: string } = () => ({
  status: 200,
  body: "{}",
});

const globals = globalThis as unknown as {
  CapacitorCustomPlatform?: { name: string };
  Capacitor?: unknown;
};

globals.CapacitorCustomPlatform = { name: "android" };
globals.Capacitor = {
  // The real bridge exposes PluginHeaders as a flat list, which is how
  // @capacitor/core looks a plugin method up.
  PluginHeaders: [{ name: "CapacitorHttp", methods: [{ name: "request", rtype: "promise" }] }],
  nativePromise: async (plugin: string, method: string, options: Record<string, any>) => {
    calls.push({ plugin, method, options });
    const { status, body } = respond(options.url);
    return {
      status,
      headers: { "Content-Type": "application/json" },
      data: body,
      url: options.url,
    };
  },
};

const json = (value: unknown) => JSON.stringify(value);

/** The last call the bridge saw for a URL fragment. */
const lastCall = (fragment: string): BridgeCall => {
  const hit = [...calls].reverse().find((c) => String(c.options.url).includes(fragment));
  assert.ok(hit, `no native call matched ${fragment}`);
  return hit;
};

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";

/** Answers the token endpoint, then /api/v1/me, the way Reddit does. */
function stubSignIn(accessToken = "native-access-token") {
  respond = (url) => {
    if (url.includes("access_token")) {
      return {
        status: 200,
        body: json({
          access_token: accessToken,
          refresh_token: "native-refresh",
          expires_in: 3600,
        }),
      };
    }
    if (url.includes("/api/v1/me")) return { status: 200, body: json({ name: "someone" }) };
    throw new Error(`unstubbed native call: ${url}`);
  };
}

const savedPost = (gifId: string) => ({
  kind: "Listing",
  data: {
    after: null,
    children: [
      {
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
        },
      },
    ],
  },
});

let native: typeof import("./native-api.ts");

before(async () => {
  native = await import("./native-api.ts");
  assert.equal(
    (await import("@capacitor/core")).Capacitor.isNativePlatform(),
    true,
    "the test must actually be running the native branch, or it proves nothing",
  );
});

describe("native transport", () => {
  it("hands the plugin a form object, never a pre-encoded string", async () => {
    calls.length = 0;
    stubSignIn();
    await native.nativeExchangeCode({
      code: "the-code",
      redirectUri: "flick://oauth",
      clientId: "myClientId",
    });

    const call = lastCall(TOKEN_URL);
    assert.equal(call.plugin, "CapacitorHttp");
    assert.equal(call.method, "request");
    // The native side urlencodes this itself; a string here would arrive as
    // grant_type%3D...%26code%3D... and Reddit would reject the grant.
    assert.deepEqual(call.options.data, {
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: "flick://oauth",
    });
    assert.equal(
      call.options.headers["Content-Type"],
      "application/x-www-form-urlencoded",
      "the native side writes no body at all without a content type",
    );
  });

  it("delivers User-Agent and the empty-password Basic header intact", async () => {
    calls.length = 0;
    stubSignIn();
    await native.nativeExchangeCode({
      code: "c",
      redirectUri: "flick://oauth",
      clientId: "myClientId",
    });

    const headers = lastCall(TOKEN_URL).options.headers;
    // This is the header Capacitor's global fetch patch would silently drop.
    assert.match(headers["User-Agent"], /app\.flick\.saved/);
    assert.equal(headers.Authorization, `Basic ${btoa("myClientId:")}`);
    assert.ok(!JSON.stringify(headers).includes("secret"));
  });

  it("passes timeouts to the plugin, whose bridge call honours no AbortSignal", async () => {
    calls.length = 0;
    respond = (url) =>
      url.includes("access_token")
        ? { status: 200, body: json({ access_token: "at" }) }
        : { status: 200, body: json({ name: "someone" }) };
    await native.nativeRefresh({ refreshToken: "rt", clientId: "id" });

    const refresh = lastCall(TOKEN_URL);
    assert.deepEqual(refresh.options.data, { grant_type: "refresh_token", refresh_token: "rt" });
    // The sign-in call has no timeout of its own, so none should be invented.
    assert.equal(refresh.options.readTimeout, undefined);
  });

  it("sends over18 on the saved listing, which Reddit needs for NSFW saves", async () => {
    calls.length = 0;
    respond = (url) =>
      url.includes("oauth.reddit.com")
        ? { status: 200, body: json(savedPost("deviceclip")) }
        : url.includes("api.redgifs.com/v2/auth/temporary")
          ? { status: 200, body: json({ token: "rg-token" }) }
          : {
              status: 200,
              body: json({
                gif: { hasAudio: true, urls: { hd: "https://media.redgifs.com/DeviceClip.mp4" } },
              }),
            };

    const page = await native.nativeSavedPage({
      accessToken: "at",
      username: "someone",
      after: null,
    });

    const listing = lastCall("oauth.reddit.com");
    assert.equal(listing.options.headers.Cookie, "over18=1");
    assert.match(String(listing.options.url), /include_over_18=1/);
    assert.equal(page.posts.length, 1);
  });
});

describe("native playback needs no proxy", () => {
  it("hands the player the CDN link, not the server's /api route", async () => {
    respond = (url) =>
      url.includes("oauth.reddit.com")
        ? { status: 200, body: json(savedPost("nativeclip")) }
        : url.includes("api.redgifs.com/v2/auth/temporary")
          ? { status: 200, body: json({ token: "rg-token" }) }
          : {
              status: 200,
              body: json({
                gif: {
                  hasAudio: true,
                  width: 1080,
                  height: 1920,
                  urls: { hd: "https://media.redgifs.com/NativeClip.mp4?expires=4102444800" },
                },
              }),
            };

    const page = await native.nativeSavedPage({
      accessToken: "at",
      username: "someone",
      after: null,
    });

    // The web app plays "/api/redgifs/<id>", a same-origin route that streams
    // the bytes for it. There is no such route on a device, so the CDN link is
    // what the player gets — and RedgifsWebViewClient re-issues it with the
    // headers the CDN demands.
    assert.equal(
      page.posts[0].video?.url,
      "https://media.redgifs.com/NativeClip.mp4?expires=4102444800",
    );
    assert.ok(
      !String(page.posts[0].video?.url).startsWith("/api/redgifs/"),
      "a proxy URL would 404 inside the app — there is no server behind it",
    );
    // Reddit's copy stays the fallback, exactly as on the web.
    assert.equal(
      page.posts[0].video?.fallbackUrl,
      "https://v.redd.it/nativeclip/DASH_480.mp4?source=fallback",
    );
  });

  it("resolves a single clip lookup to a playable CDN url too", async () => {
    respond = (url) =>
      url.includes("api.redgifs.com/v2/auth/temporary")
        ? { status: 200, body: json({ token: "rg-token" }) }
        : {
            status: 200,
            body: json({
              gif: { hasAudio: true, urls: { hd: "https://media.redgifs.com/SoloClip.mp4" } },
            }),
          };

    const clip = await native.nativeRedgifsClip({ id: "SoloClip" });

    assert.equal(clip?.url, "https://media.redgifs.com/SoloClip.mp4");
    assert.equal(clip?.hasAudio, true);
  });

  it("returns null rather than a proxy url when redgifs won't serve the clip", async () => {
    respond = (url) =>
      url.includes("api.redgifs.com/v2/auth/temporary")
        ? { status: 200, body: json({ token: "rg-token" }) }
        : { status: 404, body: json({ error: "not found" }) };

    assert.equal(await native.nativeRedgifsClip({ id: "GoneClip" }), null);
  });
});

/** A post whose link *is* the clip file, so there is no Reddit copy at all. */
function clipFilePost(id: string, file: string) {
  return {
    kind: "Listing",
    data: {
      after: null,
      children: [
        {
          kind: "t3",
          data: {
            id: `post-${id}`,
            name: `t3_post-${id}`,
            title: "clip file",
            subreddit: "NSFW_GIF",
            author: "someone",
            permalink: `/r/NSFW_GIF/comments/post-${id}/clip_file/`,
            url: `https://media.redgifs.com/${file}`,
            domain: "media.redgifs.com",
            over_18: true,
          },
        },
      ],
    },
  };
}

describe("a post that links the clip file directly", () => {
  // The parser mints this URL from the post's own link, before any lookup can
  // upgrade it, so a proxy URL here would reach the player on a device — and
  // resolve to nothing at all, skipping a post someone deliberately saved.
  it("keeps the CDN link when redgifs can't resolve an HD copy", async () => {
    respond = (url) =>
      url.includes("oauth.reddit.com")
        ? { status: 200, body: json(clipFilePost("directlinkclip", "DirectLinkClip.mp4")) }
        : url.includes("api.redgifs.com/v2/auth/temporary")
          ? { status: 200, body: json({ token: "rg-token" }) }
          : { status: 404, body: json({ error: "not found" }) };

    const page = await native.nativeSavedPage({
      accessToken: "at",
      username: "someone",
      after: null,
    });

    assert.equal(
      page.posts[0].video?.url,
      "https://media.redgifs.com/DirectLinkClip.mp4",
      "the proxy route does not exist inside the app",
    );
    assert.ok(!String(page.posts[0].video?.url).startsWith("/api/redgifs/"));
  });

  it("upgrades to the HD copy and keeps the linked file as the fallback", async () => {
    respond = (url) =>
      url.includes("oauth.reddit.com")
        ? {
            status: 200,
            body: json(clipFilePost("upgradedclip", "UpgradedClip-silent.mp4")),
          }
        : url.includes("api.redgifs.com/v2/auth/temporary")
          ? { status: 200, body: json({ token: "rg-token" }) }
          : {
              status: 200,
              body: json({
                gif: {
                  hasAudio: true,
                  urls: { hd: "https://media.redgifs.com/UpgradedClip.mp4" },
                },
              }),
            };

    const page = await native.nativeSavedPage({
      accessToken: "at",
      username: "someone",
      after: null,
    });

    // The HD copy with sound wins, exactly as on the web…
    assert.equal(page.posts[0].video?.url, "https://media.redgifs.com/UpgradedClip.mp4");
    assert.equal(page.posts[0].video?.hasAudio, true);
    // …and the linked file stays the fallback if the CDN is unreachable, still
    // as a CDN link the native client can replay rather than a dead route.
    assert.equal(
      page.posts[0].video?.fallbackUrl,
      "https://media.redgifs.com/UpgradedClip-silent.mp4",
    );
  });
});
