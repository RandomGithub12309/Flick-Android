import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HYDRATE_LIMIT,
  MAX_ENTRIES,
  entriesNeedingHydration,
  extractTweetId,
  parseBookmarksFile,
  postFromEntry,
  shrinkImport,
} from "./bookmarks.ts";
import type { BookmarkEntry, BookmarkImport } from "./types.ts";
import type { FlickPost } from "../reddit/types.ts";

/**
 * Reading someone's X bookmarks export.
 *
 * This is the file that decides what "bookmarks" means in this app, and it is
 * fed by tools that each picked their own column names, delimiters and shapes —
 * so most of what is pinned here is tolerance, and the rest is the two ways a
 * bookmark file can quietly produce a wrong deck rather than an empty one:
 * a rounded id (which 404s forever with nothing to read) and an invented id
 * (which plays someone else's tweet).
 */

const MP4 = "https://video.twimg.com/ext_tw_video/16/pu/vid/720x1280/clip.mp4?tag=14";
const ID = "1675187969420828672";

const csv = (rows: string[]) => rows.join("\n");

describe("CSV exports", () => {
  it("reads by header name, not position", () => {
    const file = csv([
      "Tweet ID,Tweet text,Author handle (@username),Tweet URL,Tweet timestamp (UTC),Media URLs",
      `${ID},"Earth from the ISS https://t.co/xyz",NASA,https://x.com/NASA/status/${ID},2024-07-02T14:00:00.000Z,${MP4}`,
    ]);
    const imported = parseBookmarksFile(file, "bookmarks.csv");
    assert.equal(imported.format, "csv");
    assert.equal(imported.entries.length, 1);
    const entry = imported.entries[0] as BookmarkEntry;
    assert.equal(entry.id, ID);
    assert.equal(entry.account, "nasa");
    assert.equal(entry.title, "Earth from the ISS https://t.co/xyz");
    assert.equal(entry.createdAt, Math.floor(Date.parse("2024-07-02T14:00:00.000Z") / 1000));
    assert.deepEqual(entry.mediaUrls, [MP4]);
  });

  it("does not care which column names the tool chose", () => {
    const file = csv(["status id;content;screen name;video url", `${ID};a clip;nasa;${MP4}`]);
    const entry = parseBookmarksFile(file, "b.csv").entries[0] as BookmarkEntry;
    assert.equal(entry.id, ID);
    assert.equal(entry.account, "nasa");
    assert.deepEqual(entry.mediaUrls, [MP4]);
  });

  it("handles quoted commas, embedded newlines and doubled quotes", () => {
    const file = csv([
      "tweet id,tweet text,media urls",
      `${ID},"He said ""hi"", then left",${MP4}`,
      `${ID},"two
lines",${MP4}`,
    ]);
    const entries = parseBookmarksFile(file, "b.csv").entries;
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.title, 'He said "hi", then left');
    assert.equal(entries[1]?.title, "two\nlines");
  });

  it("takes the id from the status URL when there is no id column", () => {
    const imported = parseBookmarksFile(
      csv(["Tweet URL", `https://x.com/NASA/status/${ID}?s=20&t=q`]),
      "urls.csv",
    );
    const entry = imported.entries[0] as BookmarkEntry;
    assert.equal(entry.id, ID);
    // The handle in a status URL is the poster's, which is exactly what the
    // slide badge wants even when the export has no author column.
    assert.equal(entry.account, "nasa");
  });

  it("unwraps a spreadsheet formula without losing a digit", () => {
    const entry = parseBookmarksFile(csv(["tweet id", `="${ID}"`]), "excel.csv")
      .entries[0] as BookmarkEntry;
    assert.equal(entry.id, ID);
    assert.equal(entry.id.length, 19);
  });

  it("counts rows it could not read instead of hiding them", () => {
    const imported = parseBookmarksFile(
      csv(["tweet id,text", `${ID},ok`, ",no id here", "abc,also no id"]),
      "mixed.csv",
    );
    assert.equal(imported.entries.length, 1);
    assert.equal(imported.rejected, 2);
  });

  it("refuses a file with no tweets in it, saying how many rows it tried", () => {
    assert.throws(
      () => parseBookmarksFile(csv(["name,age", "ada,36"]), "people.csv"),
      /No tweets found/,
    );
    assert.throws(() => parseBookmarksFile("   ", "empty.csv"), /empty/);
  });

  it("falls back to a pasted list when the first line is no header", () => {
    const imported = parseBookmarksFile(
      csv([`https://x.com/nasa/status/${ID}`, ID, "// a comment, ignored"]),
      "notes.txt",
    );
    assert.equal(imported.format, "ids");
    assert.equal(imported.entries.length, 2);
  });
});

describe("JSON exports", () => {
  it("carries whole tweet objects so the lane needs no token", () => {
    const imported = parseBookmarksFile(
      JSON.stringify([
        {
          id_str: ID,
          full_text: "clip https://t.co/aa",
          created_at: "Tue Jul 02 14:00:00 +0000 2024",
          favorite_count: 1200,
          user: { screen_name: "NASA" },
          extended_entities: {
            media: [
              {
                type: "video",
                video_info: {
                  variants: [
                    {
                      content_type: "application/x-mpegURL",
                      url: "https://video.twimg.com/x.m3u8",
                    },
                    {
                      content_type: "video/mp4",
                      bitrate: 632000,
                      url: "https://video.twimg.com/low.mp4",
                    },
                    { content_type: "video/mp4", bitrate: 2176000, url: MP4 },
                  ],
                },
              },
            ],
          },
        },
      ]),
      "tweets.json",
    );
    const entry = imported.entries[0] as BookmarkEntry;
    assert.ok(entry.raw, "the object itself must survive, not just its id");
    const post = postFromEntry(entry) as FlickPost;
    assert.equal(post.kind, "video");
    assert.equal(post.video?.url, MP4);
    assert.equal(post.score, 1200);
    assert.equal(post.account, "nasa");
  });

  it("unwraps the archive's {tweet:{…}} nesting", () => {
    const imported = parseBookmarksFile(
      JSON.stringify([{ tweet: { id_str: ID, full_text: "x", user: { screen_name: "nasa" } } }]),
      "tweets.js",
    );
    assert.equal(imported.entries[0]?.id, ID);
    assert.ok(imported.entries[0]?.raw);
  });

  it("rescues a 19-digit id written as a number, which JSON.parse would round", () => {
    // Without re-quoting, 1675187969420828672 parses to 1675187969420828700 and
    // every lookup for it 404s forever.
    const imported = parseBookmarksFile(`[{"id": ${ID}, "text": "x"}]`, "nums.json");
    assert.equal(imported.entries[0]?.id, ID);
  });

  it("reads JSONL with a junk line in it", () => {
    const imported = parseBookmarksFile(
      [`{"id_str":"${ID}"}`, "not json at all", `{"id_str":"100","full_text":"y"}`].join("\n"),
      "stream.jsonl",
    );
    assert.equal(imported.format, "jsonl");
    assert.equal(imported.entries.length, 2);
    assert.equal(imported.rejected, 1);
  });

  it("accepts a bare array of ids and URLs", () => {
    const imported = parseBookmarksFile(
      JSON.stringify([ID, `https://x.com/nasa/status/100`]),
      "ids.json",
    );
    assert.deepEqual(
      imported.entries.map((entry) => entry.id),
      [ID, "100"],
    );
  });
});

describe("ids and URLs", () => {
  it("finds a tweet id in the shapes people paste", () => {
    assert.equal(extractTweetId(ID), ID);
    assert.equal(extractTweetId(`x.com/nasa/status/${ID}/video/1`), ID);
    assert.equal(extractTweetId("twitter.com/i/web/status/100"), "100");
    assert.equal(extractTweetId(`Saved ${ID} from @x`), ID);
    // A number in prose is only an id if it looks like one; a bare cell is
    // whatever the person typed, because nothing else competes with it.
    assert.equal(extractTweetId("see page 42"), null);
    assert.equal(extractTweetId("42"), "42");
    assert.equal(extractTweetId("no digits"), null);
  });
});

describe("playability of a file-only post", () => {
  const entry = (over: Partial<BookmarkEntry>): BookmarkEntry => ({ id: ID, ...over });

  it("plays the mp4 and prefers it over a photo in the same row", () => {
    const post = postFromEntry(
      entry({ mediaUrls: ["https://pbs.twimg.com/media/a.jpg", MP4] }),
    ) as FlickPost;
    assert.equal(post.kind, "video");
    assert.equal(post.video?.url, MP4);
    // X muxes audio into the file, so the player must not go looking for a
    // sidecar track it does not have.
    assert.equal(post.video?.hasAudio, true);
    assert.equal(post.origin, "twitter");
    assert.equal(post.id, `x_${ID}`);
    assert.equal(post.permalink, `https://x.com/i/status/${ID}`);
  });

  it("treats an extension-less media host URL as video rather than dropping it", () => {
    const post = postFromEntry(entry({ mediaUrls: ["https://video.twimg.com/blob"] })) as FlickPost;
    assert.equal(post.kind, "video");
  });

  it("falls back to the still when there is no video", () => {
    const post = postFromEntry(
      entry({ mediaUrls: ["https://pbs.twimg.com/media/a.jpg?name=orig"] }),
    ) as FlickPost;
    assert.equal(post.kind, "image");
    assert.equal(post.image?.url, "https://pbs.twimg.com/media/a.jpg?name=orig");
  });

  it("yields nothing for a row with no media, so the id gets looked up", () => {
    assert.equal(postFromEntry(entry({ title: "text only" })), null);
    const needing = entriesNeedingHydration([
      entry({ title: "text only" }),
      entry({ mediaUrls: [MP4] }),
    ]);
    assert.deepEqual(
      needing.map((item) => item.id),
      [ID],
    );
  });

  it("applies the child-safety rule to text the file brought in", () => {
    assert.equal(postFromEntry(entry({ title: "young loli clip", mediaUrls: [MP4] })), null);
  });
});

describe("limits", () => {
  it("caps the import rather than swallowing a database", () => {
    const lines = Array.from(
      { length: MAX_ENTRIES + 50 },
      (_x, i) => `${1_675_000_000_000_000_000 + i}`,
    );
    const imported = parseBookmarksFile(lines.join("\n"), "huge.txt");
    assert.equal(imported.entries.length, MAX_ENTRIES);
  });

  it("leaves the deck's own ceiling well under the cap", () => {
    assert.ok(HYDRATE_LIMIT < MAX_ENTRIES);
  });

  it("shrinks to fit storage, salvaging media before it drops the object", () => {
    const big = "x".repeat(4000);
    const imported: BookmarkImport = {
      fileName: "a.json",
      importedAt: 1,
      format: "json",
      rejected: 0,
      entries: Array.from({ length: 40 }, (_x, i) => ({
        id: `${1000 + i}`,
        title: big,
        raw: {
          id: `${1000 + i}`,
          full_text: big,
          extended_entities: {
            media: [
              {
                type: "video",
                video_info: { variants: [{ content_type: "video/mp4", url: MP4 }] },
              },
            ],
          },
        },
      })),
    };
    const { import: shrunk, shrunk: didShrink } = shrinkImport(imported, 40_000);
    assert.ok(didShrink);
    // The point of the salvage: a dropped object must not mean a lost clip.
    const first = shrunk.entries[0] as BookmarkEntry;
    assert.equal(first.raw, undefined);
    assert.ok(first.mediaUrls?.includes(MP4));
    // Losing the fat fields is enough here, so nothing is truncated — the
    // staircase stops at the first step that fits.
    assert.equal(shrunk.entries.length, imported.entries.length);
    assert.ok(JSON.stringify(shrunk).length <= 40_000);

    // A budget no step can meet does truncate, and keeps at least one entry.
    const tight = shrinkImport(imported, 120);
    assert.ok(tight.import.entries.length >= 1);
    assert.ok(tight.import.entries.length < imported.entries.length);
  });

  it("leaves a file that already fits completely alone", () => {
    const imported: BookmarkImport = {
      fileName: "a.csv",
      importedAt: 1,
      format: "csv",
      rejected: 0,
      entries: [{ id: ID, mediaUrls: [MP4] }],
    };
    const result = shrinkImport(imported, 100_000);
    assert.equal(result.shrunk, false);
    assert.deepEqual(result.import.entries, imported.entries);
  });
});
