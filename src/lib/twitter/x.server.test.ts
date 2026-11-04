import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { clearTwitterCaches, fetchTwitterFeed } from "./x.server.ts";

/**
 * The X lane's request policy, with `fetch` stubbed — nothing here touches
 * x.com.
 *
 * What's pinned is the part a reader can't get from the parser: which transport
 * is chosen, that the request asks for the fields the player depends on, and
 * what a refused token does to the shuffle. A lane that hard-fails on a 401 is
 * the difference between "a shorter deck" and "Flick appears broken", and only a
 * test keeps that from being optimised away later.
 */

const realFetch = globalThis.fetch;

type Recorded = { url: string; headers: Record<string, string> };
let calls: Recorded[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stub(routes: Array<[RegExp, (url: string) => Response | Promise<Response>]>) {
  calls = [];
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url, headers });
    for (const [match, respond] of routes) {
      if (match.test(url)) return await respond(url);
    }
    throw new Error(`unstubbed request: ${url}`);
  }) as typeof fetch;
}

const MP4 = "https://video.twimg.com/ext_tw_video/1/pu/vid/720x1280/clip.mp4?tag=14";

const userLookup = { data: { id: "45", username: "nasa", name: "NASA" } };

const tweetsPage = (nextToken: string | null, id = "100") => ({
  data: [
    {
      id,
      text: "clip https://t.co/aa",
      created_at: "2024-05-01T12:00:00.000Z",
      public_metrics: { like_count: 10 },
      author_id: "45",
      attachments: { media_keys: ["13_1"] },
    },
  ],
  includes: {
    media: [
      {
        media_key: "13_1",
        type: "video",
        width: 720,
        height: 1280,
        duration_ms: 9000,
        variants: [{ bit_rate: 2176000, content_type: "video/mp4", url: MP4 }],
      },
    ],
    users: [{ id: "45", username: "nasa", name: "NASA" }],
  },
  meta: nextToken ? { result_count: 1, next_token: nextToken } : { result_count: 1 },
});

const embedHtml = (tweet: unknown) =>
  `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { timeline: { entries: [{ entry_id: "1", content: { tweet } }] } } },
  })}</script></html>`;

const embedTweet = {
  id_str: "200",
  full_text: "from the embed feed https://t.co/bb",
  created_at: "Tue Jul 02 14:00:00 +0000 2024",
  favorite_count: 5,
  user: { screen_name: "nasa" },
  extended_entities: {
    media: [
      {
        type: "video",
        media_url_https: "https://pbs.twimg.com/amplify_video_thumb/1/img/poster.jpg",
        video_info: {
          duration_millis: 5000,
          variants: [{ bitrate: 862000, content_type: "video/mp4", url: MP4 }],
        },
      },
    ],
  },
};

beforeEach(() => {
  clearTwitterCaches();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  calls = [];
  delete process.env.X_BEARER_TOKEN;
  delete process.env.X_API_BASE;
});

describe("transport choice", () => {
  it("uses the public embed feed, and only that, when no token is configured", async () => {
    stub([
      [/syndication\.twitter\.com/, () => new Response(embedHtml(embedTweet), { status: 200 })],
    ]);
    const feed = await fetchTwitterFeed({ handle: "@nasa" });
    assert.equal(calls.length, 1, "no API call may be attempted without a token");
    assert.equal(feed.transport, "embed");
    assert.equal(feed.posts[0]?.kind, "video");
    assert.equal(feed.posts[0]?.video?.url, MP4);
  });

  it("reads a deployment token from the environment, so the app works with nothing pasted", async () => {
    process.env.X_BEARER_TOKEN = "env-token";
    stub([
      [/\/2\/users\/by\/username/, () => json(userLookup)],
      [/\/tweets/, () => json(tweetsPage(null))],
    ]);
    const feed = await fetchTwitterFeed({ handle: "nasa" });
    assert.equal(feed.transport, "api");
    assert.equal(calls[0]?.headers.Authorization, "Bearer env-token");
    assert.equal(feed.posts[0]?.account, "nasa");
  });

  it("accepts a pasted handle or URL as the handle", async () => {
    stub([[/syndication\.twitter\.com/, () => new Response(embedHtml(embedTweet))]]);
    const feed = await fetchTwitterFeed({ handle: "https://x.com/NASA/" });
    assert.equal(calls[0]?.url.includes("/screen-name/nasa"), true);
    assert.equal(feed.username, "nasa");
  });

  it("refuses an unparseable handle before it spends a request", async () => {
    stub([]);
    await assert.rejects(() => fetchTwitterFeed({ handle: "not a handle!" }), /not an X handle/);
    assert.equal(calls.length, 0);
  });
});

describe("the v2 request itself", () => {
  it("asks for the media fields the player needs and the exclusions that keep the deck clean", async () => {
    process.env.X_BEARER_TOKEN = "tok";
    stub([
      [/\/2\/users\/by\/username/, () => json(userLookup)],
      [/\/tweets/, () => json(tweetsPage(null))],
    ]);
    await fetchTwitterFeed({ handle: "nasa" });
    const tweets = new URL(calls[1]?.url ?? "");
    // `variants` is the only field that carries a playable file; `url` alone
    // would return videos with nothing in them.
    assert.match(tweets.searchParams.get("media.fields") ?? "", /variants/);
    assert.match(tweets.searchParams.get("expansions") ?? "", /attachments\.media_keys/);
    assert.match(tweets.searchParams.get("expansions") ?? "", /referenced_tweets\.id/);
    assert.equal(tweets.searchParams.get("exclude"), "retweets,replies");
    assert.equal(tweets.pathname, "/2/users/45/tweets");
  });

  it("follows the page cursor, and stops at its own budget", async () => {
    process.env.X_BEARER_TOKEN = "tok";
    let page = 0;
    stub([
      [/\/2\/users\/by\/username/, () => json(userLookup)],
      [
        /\/tweets/,
        () => {
          page += 1;
          return json(tweetsPage(page < 6 ? `cursor${page}` : null, `10${page}`));
        },
      ],
    ]);
    const feed = await fetchTwitterFeed({ handle: "nasa" });
    // Three pages is the cap: a shuffle must not turn into a crawl through a
    // decade of posts, however eager the account is.
    assert.equal(page, 3);
    assert.equal(feed.posts.length, 3, "one post per page");
    assert.equal(feed.after, "cursor3");
    assert.match(calls[2]?.url ?? "", /pagination_token=cursor1/);
  });

  it("stops passing requests on once its own minute budget is gone", async () => {
    // The endpoint is public and fronts a third-party rate limit, so the cap is
    // the only thing between one curious visitor and the deployment being
    // throttled for everyone else. 20 is the keyless feed's budget.
    stub([[/syndication\.twitter\.com/, () => new Response(embedHtml(embedTweet))]]);
    for (let i = 0; i < 20; i++) {
      await fetchTwitterFeed({ handle: `user${i}` });
    }
    await assert.rejects(
      () => fetchTwitterFeed({ handle: "lastone" }),
      /try again in a minute/,
    );
    assert.equal(calls.length, 20, "the 21st request must not reach X at all");
  });

  it("caches the lookup and the feed, so a shuffle is not a rate-limit violation", async () => {
    process.env.X_BEARER_TOKEN = "tok";
    stub([
      [/\/2\/users\/by\/username/, () => json(userLookup)],
      [/\/tweets/, () => json(tweetsPage(null))],
    ]);
    await fetchTwitterFeed({ handle: "nasa" });
    const after = calls.length;
    await fetchTwitterFeed({ handle: "nasa" });
    assert.equal(calls.length, after, "second call must be served from cache");
  });
});

describe("when X says no", () => {
  it("downgrades a refused token to the embed feed and says so", async () => {
    process.env.X_BEARER_TOKEN = "expired";
    stub([
      [
        /\/2\/users\/by\/username/,
        () => json({ error: "unauthorized", detail: "Unauthorized" }, 401),
      ],
      [/syndication\.twitter\.com/, () => new Response(embedHtml(embedTweet))],
    ]);
    const feed = await fetchTwitterFeed({ handle: "nasa" });
    assert.equal(feed.transport, "embed");
    assert.match(feed.warning ?? "", /Bearer token/);
    assert.equal(feed.posts.length, 1, "the shuffle still has the X lane");
  });

  it("explains a plan that cannot read timelines", async () => {
    process.env.X_BEARER_TOKEN = "free-tier";
    stub([
      [
        /\/2\/users\/by\/username/,
        () => json({ detail: "You do not have elevated access to this resource" }, 403),
      ],
      [/syndication\.twitter\.com/, () => json({}, 503)],
    ]);
    await assert.rejects(
      () => fetchTwitterFeed({ handle: "nasa" }),
      /didn't answer \(HTTP 503\)|rate-limiting/,
    );
  });

  it("names a handle that does not exist", async () => {
    process.env.X_BEARER_TOKEN = "tok";
    stub([[/\/2\/users\/by\/username/, () => json({ errors: [{ message: "Not found" }] }, 404)]]);
    await assert.rejects(() => fetchTwitterFeed({ handle: "nope" }), /No X account/);
  });

  it("says plainly when the embed feed is down, instead of pretending the account is empty", async () => {
    stub([[/syndication\.twitter\.com/, () => new Response("<html>rate</html>", { status: 429 })]]);
    await assert.rejects(() => fetchTwitterFeed({ handle: "nasa" }), /rate-limiting this server/);
  });

  it("reports an account with nothing playable as a warning the UI can show", async () => {
    stub([
      [
        /syndication\.twitter\.com/,
        () =>
          new Response(
            embedHtml({ id_str: "3", full_text: "words only", user: { screen_name: "nasa" } }),
          ),
      ],
    ]);
    await assert.rejects(
      () => fetchTwitterFeed({ handle: "nasa" }),
      /nothing playable|no playable posts/,
    );
  });
});
