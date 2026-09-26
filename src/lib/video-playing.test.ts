import assert from "node:assert/strict";
import test from "node:test";
import { effectiveDuration, isVideoPlaying, shouldSkipDeadVideo } from "./video-playing";

const state = (
  overrides: Partial<{ paused: boolean; ended: boolean; currentTime: number }> = {},
) => ({
  paused: true,
  ended: false,
  currentTime: 0,
  ...overrides,
});

const shouldSkip = (overrides: Partial<Parameters<typeof shouldSkipDeadVideo>[0]> = {}) =>
  shouldSkipDeadVideo({
    active: true,
    blocked: false,
    reported: false,
    video: state(),
    reason: "start-timeout",
    ...overrides,
  });

test("recognizes active playback and ended or paused media", () => {
  assert.equal(isVideoPlaying(state({ paused: false })), true);
  assert.equal(isVideoPlaying(state({ paused: true })), false);
  assert.equal(isVideoPlaying(state({ paused: false, ended: true })), false);
  assert.equal(isVideoPlaying(null), false);
});

test("never skips inactive, tap-to-play, or already-reported videos", () => {
  assert.equal(shouldSkip({ active: false }), false);
  assert.equal(shouldSkip({ blocked: true }), false);
  assert.equal(shouldSkip({ reported: true }), false);
});

test("never skips a video that is currently playing", () => {
  assert.equal(shouldSkip({ video: state({ paused: false }) }), false);
  assert.equal(shouldSkip({ video: state({ paused: false, currentTime: 4 }) }), false);
});

test("a start timeout does not skip media that has advanced beyond 0.1 seconds", () => {
  assert.equal(shouldSkip({ video: state({ currentTime: 0.11 }) }), false);
  assert.equal(shouldSkip({ video: state({ currentTime: 0.1 }) }), true);
});

test("a hard error can skip a frozen clip even after it advanced", () => {
  assert.equal(shouldSkip({ reason: "error", video: state({ currentTime: 3 }) }), true);
  assert.equal(
    shouldSkip({ reason: "error", video: state({ paused: false, currentTime: 3 }) }),
    false,
  );
});

test("prefers a finite duration, then the seekable end, then unknown", () => {
  assert.equal(effectiveDuration(12.5, null), 12.5);
  assert.equal(effectiveDuration(12.5, 30), 12.5);
  // Fragmented uploads report Infinity/NaN while still seekable.
  assert.equal(effectiveDuration(Infinity, 30), 30);
  assert.equal(effectiveDuration(NaN, 30), 30);
  assert.equal(effectiveDuration(0, 30), 30);
  // Nothing usable anywhere: unknown.
  assert.equal(effectiveDuration(Infinity, null), 0);
  assert.equal(effectiveDuration(NaN, NaN), 0);
  assert.equal(effectiveDuration(0, 0), 0);
});
