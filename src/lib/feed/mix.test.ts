import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mediaKeyOf, orderDeck } from "./mix.ts";
import type { FlickPost } from "../reddit/types.ts";

function post(id: string, url?: string): FlickPost {
  return {
    id,
    name: id,
    title: `reddit ${id}`,
    subreddit: "Unexpected",
    author: "someone",
    permalink: `https://reddit.com/r/Unexpected/comments/${id}`,
    nsfw: false,
    score: 1,
    createdUtc: 0,
    kind: "video",
    video: {
      url: url ?? `https://cdn.example.com/reddit/${id}.mp4`,
      width: 720,
      height: 1280,
      hasAudio: true,
    },
  };
}

const lane = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => post(`${prefix}${i}`));

const seeded = () => {
  let seed = 42;
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
};

describe("orderDeck — Reddit shuffle", () => {
  it("shuffles all unique posts", () => {
    const reddit = lane("r", 30);
    const out = orderDeck(reddit, { random: seeded() });
    assert.equal(out.length, 30);
    assert.equal(new Set(out.map((item) => item.id)).size, 30);
  });

  it("treats a re-signed URL as the same file and deduplicates", () => {
    assert.equal(
      mediaKeyOf(post("a", "https://v.redd.it/abc/CMAF_720.mp4?token=1")),
      mediaKeyOf(post("b", "https://v.redd.it/abc/CMAF_720.mp4?token=2")),
    );
    const out = orderDeck(
      [
        post("a", "https://v.redd.it/abc/CMAF_720.mp4?token=1"),
        post("b", "https://v.redd.it/abc/CMAF_720.mp4?token=2"),
        post("c"),
      ],
      { random: seeded() },
    );
    assert.equal(out.length, 2);
  });

  it("is repeatable for a given seed", () => {
    const a = orderDeck(lane("r", 15), { random: seeded() });
    const b = orderDeck(lane("r", 15), { random: seeded() });
    assert.deepEqual(
      a.map((item) => item.id),
      b.map((item) => item.id),
    );
  });
});
