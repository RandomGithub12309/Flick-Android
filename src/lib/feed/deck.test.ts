import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mediaKeyOf, orderDeck } from "./deck.ts";
import type { FlickPost } from "../reddit/types.ts";

/**
 * The deck is the last thing between a saved list and a swipeable player, and
 * both of its jobs fail invisibly: played in Reddit's order it looks fine until
 * someone notices they have seen the same week of saves three times, and a
 * fetched list that keeps every repost of one clip looks fine until that clip
 * comes up again. So these pin the shape of the result — uniqueness, and no
 * input order — rather than exact positions, which is all a shuffle can be
 * tested on.
 */

function post(id: string, url?: string): FlickPost {
  return {
    id,
    name: `t3_${id}`,
    title: `post ${id}`,
    subreddit: "Unexpected",
    author: "someone",
    permalink: `https://reddit.com/r/Unexpected/comments/${id}`,
    nsfw: false,
    score: 1,
    createdUtc: 0,
    kind: url ? "video" : "text",
    ...(url
      ? { video: { url, width: 720, height: 1280, hasAudio: true } }
      : { text: `no media here ${id}` }),
  };
}

/** Deterministic shuffle: every assertion below must be repeatable. */
const seeded = () => {
  let seed = 42;
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
};

const ids = (posts: FlickPost[]) => posts.map((item) => item.id).sort();

describe("the deck", () => {
  it("keeps one slide per clip, whoever re-posted it", () => {
    const deck = orderDeck([
      post("a", "https://v.redd.it/one.mp4"),
      post("b", "https://v.redd.it/one.mp4"),
    ]);
    assert.deepEqual(
      deck.map((item) => item.id),
      ["a"],
      "the first listing wins, and the repost costs no slide",
    );
  });

  it("sees a re-signed URL as the same file", () => {
    // Reddit stamps its media URLs per request, so a naive key would let one
    // clip through twice the moment a listing is refetched.
    const fresh = mediaKeyOf(post("a", "https://v.redd.it/one.mp4?sig=old"));
    const stale = mediaKeyOf(post("b", "https://v.redd.it/one.mp4?sig=new#t=0"));
    assert.equal(fresh, stale);
    assert.equal(
      orderDeck([
        post("a", "https://v.redd.it/one.mp4?sig=old"),
        post("b", "https://v.redd.it/one.mp4?sig=new"),
      ]).length,
      1,
    );
  });

  it("keeps distinct clips from the same subreddit", () => {
    const deck = orderDeck([
      post("a", "https://v.redd.it/one.mp4"),
      post("b", "https://v.redd.it/two.mp4"),
      post("c", "https://v.redd.it/three.mp4"),
    ]);
    assert.equal(deck.length, 3);
  });

  it("falls back to the id when a post has no media", () => {
    const deck = orderDeck([post("x"), post("y"), post("x")]);
    assert.deepEqual(ids(deck), ["x", "y"], "two text posts are two slides; a repeat is not");
  });

  it("does not play the fetch order", () => {
    const input = Array.from({ length: 40 }, (_, i) => post(`p${i}`, `https://v.redd.it/${i}.mp4`));
    const deck = orderDeck(input, { random: seeded() });
    assert.deepEqual(ids(deck), ids(input), "shuffling must lose nothing");
    const sameAt = deck.filter((item, i) => item.id === input[i]?.id).length;
    assert.ok(sameAt < 5, `only ${sameAt} of 40 landed where they started`);
  });

  it("spreads a clip that appears twice far apart — by removing it", () => {
    const input = [
      post("head", "https://v.redd.it/head.mp4"),
      ...Array.from({ length: 30 }, (_, i) => post(`p${i}`, `https://v.redd.it/${i}.mp4`)),
      post("head-copy", "https://v.redd.it/head.mp4"),
    ];
    const deck = orderDeck(input, { random: seeded() });
    assert.equal(deck.length, 31);
    assert.ok(
      !deck.some(
        (item) => mediaKeyOf(item) === "https://v.redd.it/head.mp4" && item.id === "head-copy",
      ),
    );
  });

  it("handles nothing at all", () => {
    assert.deepEqual(orderDeck([]), []);
    assert.deepEqual(orderDeck([], { random: seeded() }), []);
  });
});
