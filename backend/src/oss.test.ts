import assert from "node:assert/strict";
import test from "node:test";
import { createOssObjectName } from "./oss.js";

test("creates a dated temporary OSS object name", () => {
  assert.equal(
    createOssObjectName("image/jpeg", "image-id", new Date("2026-09-16T08:09:10.000Z")),
    "script-master/upscale-inputs/2026/09/16/image-id.jpg",
  );
  assert.equal(
    createOssObjectName("image/webp", "avatar-id", new Date("2026-09-16T08:09:10.000Z")),
    "script-master/upscale-inputs/2026/09/16/avatar-id.webp",
  );
});
