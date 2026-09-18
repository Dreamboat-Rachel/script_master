import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVideoDuration, videoModelOptions, videoResolutionOptions } from "./video.js";

test("exposes Seedance 2.5 and all supported video resolutions", () => {
  assert.ok(videoModelOptions.includes("doubao-seedance-2-5-260628"));
  assert.deepEqual(videoResolutionOptions, ["480p", "720p", "1080p"]);
});

test("normalizes generated shot durations to provider-supported values", () => {
  assert.equal(normalizeVideoDuration(3), 4);
  assert.equal(normalizeVideoDuration(7), 6);
  assert.equal(normalizeVideoDuration(9), 8);
  assert.equal(normalizeVideoDuration(13), 12);
});
