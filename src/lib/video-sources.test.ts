import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { audioCandidatesFor, audioUrlsForSource, videoSources } from "./video-sources.ts";

describe("video sources are tried best first", () => {
  it("puts the real clip ahead of the host's copy", () => {
    const sources = videoSources({
      url: "https://media.redgifs.com/Clip.mp4",
      fallbackUrl: "https://v.redd.it/clip/DASH_480.mp4",
    });

    assert.deepEqual(sources, [
      "https://media.redgifs.com/Clip.mp4",
      "https://v.redd.it/clip/DASH_480.mp4",
    ]);
  });

  it("plays a post that has only the one file", () => {
    assert.deepEqual(videoSources({ url: "https://v.redd.it/x/DASH_480.mp4" }), [
      "https://v.redd.it/x/DASH_480.mp4",
    ]);
  });

  it("does not offer the same file twice", () => {
    const sources = videoSources({
      url: "https://v.redd.it/x/DASH_480.mp4",
      fallbackUrl: "https://v.redd.it/x/DASH_480.mp4",
    });

    assert.deepEqual(sources, ["https://v.redd.it/x/DASH_480.mp4"]);
  });
});

describe("audio follows the source that is on screen", () => {
  it("gives a redgifs clip no sidecar, because its sound is in the mp4", () => {
    // The shape the resolver actually produces for a swapped post: the primary
    // is the redgifs mp4 with no sidecar, and the audio sits on the fallback.
    const video = {
      url: "https://media.redgifs.com/Clip.mp4",
      fallbackUrl: "https://v.redd.it/clip/DASH_480.mp4",
      fallbackAudioUrls: ["https://v.redd.it/clip/DASH_AUDIO_64.mp4"],
    };

    // Playing the sidecar against the primary would play the clip's own audio
    // twice, out of sync with itself.
    assert.deepEqual(audioUrlsForSource(video, false), []);
    assert.deepEqual(audioUrlsForSource(video, true), ["https://v.redd.it/clip/DASH_AUDIO_64.mp4"]);
  });

  it("never pairs the fallback's audio with the primary source", () => {
    const video = {
      url: "https://media.redgifs.com/Clip.mp4",
      fallbackUrl: "https://v.redd.it/clip/DASH_480.mp4",
      fallbackAudioUrls: ["https://v.redd.it/clip/DASH_AUDIO_64.mp4"],
    };

    // The primary has no `audioUrls` of its own, so the fallback's sidecar can
    // never leak into playback while redgifs is the file on screen.
    assert.equal(audioUrlsForSource(video, false).length, 0);
  });

  it("keeps a v.redd.it upload's own audio on the primary source", () => {
    const video = {
      url: "https://v.redd.it/x/DASH_720.mp4",
      audioUrls: [
        "https://v.redd.it/x/CMAF_AUDIO_128.mp4",
        "https://v.redd.it/x/DASH_AUDIO_128.mp4",
      ],
    };

    assert.deepEqual(audioUrlsForSource(video, false), [
      "https://v.redd.it/x/CMAF_AUDIO_128.mp4",
      "https://v.redd.it/x/DASH_AUDIO_128.mp4",
    ]);
  });

  it("falls back to a lone audioUrl when there is no list", () => {
    const video = {
      url: "https://v.redd.it/x/DASH_720.mp4",
      audioUrl: "https://v.redd.it/x/DASH_AUDIO_128.mp4",
    };

    assert.deepEqual(audioUrlsForSource(video, false), ["https://v.redd.it/x/DASH_AUDIO_128.mp4"]);
  });

  it("stays silent rather than guessing when a fallback carries no audio", () => {
    assert.deepEqual(audioUrlsForSource({}, true), []);
  });
});

describe("audio candidates survive being carried across a swap", () => {
  it("prefers the full list over the single url", () => {
    const list = audioCandidatesFor({
      audioUrl: "https://v.redd.it/x/A.mp3",
      audioUrls: ["https://v.redd.it/x/B.mp3"],
    });

    assert.deepEqual(list, ["https://v.redd.it/x/B.mp3"]);
  });

  it("promotes a lone audioUrl so a fallback is not dropped", () => {
    assert.deepEqual(audioCandidatesFor({ audioUrl: "https://v.redd.it/x/A.mp3" }), [
      "https://v.redd.it/x/A.mp3",
    ]);
  });

  it("is undefined when there is no video or no audio to keep", () => {
    assert.equal(audioCandidatesFor(undefined), undefined);
    assert.equal(audioCandidatesFor({}), undefined);
    assert.equal(audioCandidatesFor({ audioUrls: [] }), undefined);
  });
});
