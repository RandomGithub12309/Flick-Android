import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mediaKeyOf, mixFeeds, orderDeck, originsIn } from "./mix.ts";
import type { FlickPost } from "../reddit/types.ts";

/**
 * The mix is the feature, and the failure modes are invisible in a code review:
 * a `concat`-then-shuffle "mix" buries the smaller lane and looks fine until
 * someone swipes forty times to find one tweet. So these pin the shape of the
 * result — adjacency and share — rather than exact positions, which is what a
 * shuffled deck can be tested on.
 */

function post(id: string, origin: "reddit" | "twitter", url?: string): FlickPost {
  return {
    id: origin === "twitter" ? `x_${id}` : id,
    name: id,
    title: `${origin} ${id}`,
    subreddit: origin === "reddit" ? "Unexpected" : "",
    author: origin === "reddit" ? "someone" : "nasa",
    account: origin === "twitter" ? "nasa" : undefined,
    origin,
    permalink: `https://example.com/${id}`,
    nsfw: false,
    score: 1,
    createdUtc: 0,
    kind: "video",
    video: {
      url: url ?? `https://cdn.example.com/${origin}/${id}.mp4`,
      width: 720,
      height: 1280,
      hasAudio: true,
    },
  };
}

const lane = (prefix: string, count: number, origin: "reddit" | "twitter") =>
  Array.from({ length: count }, (_, i) => post(`${prefix}${i}`, origin));

/** Deterministic shuffle: every assertion below must be repeatable. */
const seeded = () => {
  let seed = 42;
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
};

function isTwitter(post: FlickPost): boolean {
  return (post.origin ?? "reddit") === "twitter";
}

function maxRun(posts: FlickPost[], predicate: (post: FlickPost) => boolean): number {
  let best = 0;
  let run = 0;
  for (const item of posts) {
    run = predicate(item) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

describe("mixFeeds — spread, not stapled", () => {
  it("keeps every post of the smaller lane and spreads it through the deck", () => {
    const reddit = lane("r", 20, "reddit");
    const twitter = lane("t", 6, "twitter");
    const out = mixFeeds(reddit, twitter, { random: seeded() });
    assert.equal(out.length, 26);
    assert.equal(out.filter(isTwitter).length, 6);
    // A tweet every ~4 slides. Two in a row means the "mix" is a tail.
    assert.equal(maxRun(out, isTwitter), 1);
  });

  it("caps the added lane so a big timeline can't bury a small saved list", () => {
    const out = mixFeeds(lane("r", 10, "reddit"), lane("t", 100, "twitter"), {
      random: seeded(),
    });
    const tweets = out.filter(isTwitter).length;
    assert.equal(out.length, 20);
    assert.equal(tweets, 10, "neither lane may exceed half the deck");
    assert.equal(maxRun(out, isTwitter), 1);
    assert.equal(
      maxRun(out, (item) => !isTwitter(item)),
      1,
    );
  });

  it("spreads the Reddit lane through a tweet-heavy deck instead of dropping it", () => {
    const out = mixFeeds(lane("r", 3, "reddit"), lane("t", 12, "twitter"), {
      random: seeded(),
      maxShare: 1,
    });
    assert.equal(out.length, 15);
    assert.equal(out.filter((item) => !isTwitter(item)).length, 3);
    // Nobody swipes a dozen tweets to find out Reddit is configured at all.
    assert.ok(out.slice(0, 6).some((item) => !isTwitter(item)));
  });

  it("degrades to the plain shuffle when a lane came back empty", () => {
    const reddit = lane("r", 8, "reddit");
    const out = mixFeeds(reddit, [], { random: seeded() });
    assert.equal(out.length, 8);
    assert.deepEqual([...out].map((item) => item.id).sort(), reddit.map((item) => item.id).sort());
  });

  it("drops a clip both hosts carry, keeping the lane it was pulled for first", () => {
    const shared = "https://cdn.example.com/shared/clip.mp4";
    const out = mixFeeds(
      [post("a", "reddit", shared), post("b", "reddit")],
      [post("c", "twitter", `${shared}?sig=zz9`), post("d", "twitter")],
      { random: seeded() },
    );
    assert.equal(out.length, 3);
    assert.ok(out.some((item) => item.id === "a"));
    assert.ok(out.some((item) => item.id === "x_d"));
  });

  it("treats a re-signed URL as the same file", () => {
    assert.equal(
      mediaKeyOf(post("a", "reddit", "https://v.redd.it/abc/CMAF_720.mp4?token=1")),
      mediaKeyOf(post("b", "reddit", "https://v.redd.it/abc/CMAF_720.mp4?token=2")),
    );
  });

  it("is repeatable for a given seed", () => {
    const a = mixFeeds(lane("r", 9, "reddit"), lane("t", 4, "twitter"), { random: seeded() });
    const b = mixFeeds(lane("r", 9, "reddit"), lane("t", 4, "twitter"), { random: seeded() });
    assert.deepEqual(
      a.map((item) => item.id),
      b.map((item) => item.id),
    );
  });
});

describe("orderDeck — one setPosts for one lane or two", () => {
  it("mixes by reading the posts, not by being told a mix happened", () => {
    const out = orderDeck([...lane("r", 12, "reddit"), ...lane("t", 4, "twitter")], {
      random: seeded(),
    });
    assert.equal(out.length, 16);
    assert.equal(maxRun(out, isTwitter), 1);
  });

  it("shuffles a Reddit-only deck exactly as it did before X was added", () => {
    const reddit = lane("r", 30, "reddit");
    const out = orderDeck(reddit, { random: seeded() });
    assert.equal(out.length, 30);
    assert.equal(out.some(isTwitter), false);
    assert.equal(new Set(out.map((item) => item.id)).size, 30);
  });

  it("handles a deck that is all X (Reddit off, or the lane failed)", () => {
    const out = orderDeck([...lane("t", 5, "twitter")], { random: seeded() });
    assert.equal(out.length, 5);
    assert.equal(out.every(isTwitter), true);
  });

  it("defaults an untagged post to Reddit", () => {
    const bare = { ...post("z", "reddit"), origin: undefined } as FlickPost;
    assert.deepEqual(originsIn([bare, post("y", "twitter")]), ["reddit", "twitter"]);
    assert.equal(orderDeck([bare], { random: seeded() }).length, 1);
  });
});
