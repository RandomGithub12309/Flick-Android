import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  clampPlaybackRate,
  playbackRateFromRatio,
  ratioFromPlaybackRate,
} from "./playback-rate.ts";

describe("playback rate mapping", () => {
  it("maps the bar ends to the rate bounds", () => {
    assert.equal(playbackRateFromRatio(0), MIN_PLAYBACK_RATE);
    assert.equal(playbackRateFromRatio(1), MAX_PLAYBACK_RATE);
  });

  it("clamps out-of-range positions", () => {
    assert.equal(playbackRateFromRatio(-3), MIN_PLAYBACK_RATE);
    assert.equal(playbackRateFromRatio(7), MAX_PLAYBACK_RATE);
  });

  // Garbage input should land on the slowest setting, not NaN (which would
  // poison the video's playbackRate) and not a surprise 3x jump.
  it("treats non-finite input as the far left rather than NaN", () => {
    assert.equal(playbackRateFromRatio(Number.NaN), MIN_PLAYBACK_RATE);
    assert.equal(playbackRateFromRatio(Number.POSITIVE_INFINITY), MIN_PLAYBACK_RATE);
    assert.equal(playbackRateFromRatio(Number.NEGATIVE_INFINITY), MIN_PLAYBACK_RATE);
  });

  it("is monotonic — dragging right never slows the video down", () => {
    let previous = 0;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const rate = playbackRateFromRatio(t);
      assert.ok(rate > previous, `rate went backwards at t=${t.toFixed(2)}`);
      previous = rate;
    }
  });

  it("round-trips ratio -> rate -> ratio", () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const rate = playbackRateFromRatio(t);
      const back = ratioFromPlaybackRate(rate);
      assert.ok(Math.abs(back - t) < 1e-9, `round-trip drifted at t=${t}`);
    }
  });

  // The whole point of the exponential curve: 1x should sit past the middle,
  // leaving real travel for the slow end.
  it("places 1x past the midpoint so the slow half is reachable", () => {
    const at = ratioFromPlaybackRate(1);
    assert.ok(at > 0.5, `1x sat at ${at.toFixed(3)}, expected right of centre`);
    assert.ok(at < 0.7, `1x sat at ${at.toFixed(3)}, expected left of 70%`);
  });

  it("clamps rate at both ends", () => {
    assert.equal(clampPlaybackRate(0), MIN_PLAYBACK_RATE);
    assert.equal(clampPlaybackRate(99), MAX_PLAYBACK_RATE);
    assert.equal(clampPlaybackRate(1.5), 1.5);
  });

  it("falls back to 1x for NaN but clamps infinities to the range", () => {
    assert.equal(clampPlaybackRate(Number.NaN), 1);
    assert.equal(clampPlaybackRate(Number.NEGATIVE_INFINITY), MIN_PLAYBACK_RATE);
    assert.equal(clampPlaybackRate(Number.POSITIVE_INFINITY), MAX_PLAYBACK_RATE);
  });
});
