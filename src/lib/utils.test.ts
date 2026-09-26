import assert from "node:assert/strict";
import test from "node:test";
import { formatTime } from "./utils";

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
