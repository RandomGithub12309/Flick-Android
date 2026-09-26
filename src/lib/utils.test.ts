import assert from "node:assert/strict";
import test from "node:test";
import { containRect, formatTime, isLandscapeRatio, mediaRatio } from "./utils";

test("formatTime renders minutes and padded seconds under an hour", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(5), "0:05");
  assert.equal(formatTime(59), "0:59");
  assert.equal(formatTime(60), "1:00");
  assert.equal(formatTime(65), "1:05");
  assert.equal(formatTime(600), "10:00");
  assert.equal(formatTime(3599), "59:59");
});

test("formatTime adds an hours field past the hour", () => {
  assert.equal(formatTime(3600), "1:00:00");
  assert.equal(formatTime(3661), "1:01:01");
  assert.equal(formatTime(36_000), "10:00:00");
});

test("formatTime floors fractional seconds instead of rounding up", () => {
  assert.equal(formatTime(59.9), "0:59");
  assert.equal(formatTime(61.999), "1:01");
});

test("formatTime clamps anything that isn't a usable duration to zero", () => {
  // A video that has not reported metadata yet must read as 0:00 rather than
  // leaking NaN or -Infinity into the seek bar's readout.
  assert.equal(formatTime(-1), "0:00");
  assert.equal(formatTime(Number.NaN), "0:00");
  assert.equal(formatTime(Number.POSITIVE_INFINITY), "0:00");
  assert.equal(formatTime(Number.NEGATIVE_INFINITY), "0:00");
});

test("mediaRatio is null for unusable sizes", () => {
  assert.equal(mediaRatio(), null);
  assert.equal(mediaRatio(0, 9), null);
  assert.equal(mediaRatio(16, 0), null);
  assert.equal(mediaRatio(-16, 9), null);
  assert.equal(mediaRatio(Number.NaN, 9), null);
});

test("mediaRatio and isLandscapeRatio classify 16:9 vs 9:16", () => {
  assert.equal(mediaRatio(1920, 1080), 1920 / 1080);
  assert.equal(isLandscapeRatio(mediaRatio(1920, 1080)), true);
  assert.equal(isLandscapeRatio(mediaRatio(1080, 1920)), false);
  assert.equal(isLandscapeRatio(mediaRatio(100, 100)), false);
  assert.equal(isLandscapeRatio(null), false);
});

test("containRect letterboxes 16:9 into a portrait frame without cropping", () => {
  const box = containRect(1080, 1920, 1920, 1080);
  assert.equal(box.width, 1080);
  assert.equal(box.height, 1080 * (1080 / 1920));
  assert.equal(box.left, 0);
  assert.equal(box.top, (1920 - box.height) / 2);
  // Fitted height is well under the frame — the sides aren't cropped.
  assert.ok(box.height < 1920);
});

test("containRect fits 9:16 into the same portrait frame", () => {
  const box = containRect(1080, 1920, 1080, 1920);
  assert.equal(box.width, 1080);
  assert.equal(box.height, 1920);
  assert.equal(box.left, 0);
  assert.equal(box.top, 0);
});
