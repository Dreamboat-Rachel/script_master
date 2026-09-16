import assert from "node:assert/strict";
import test from "node:test";
import { createImageUpscaleSubmitPayload, createVolcengineAuthorization } from "./upscale.js";

test("creates the expected Volcengine HMAC authorization", () => {
  const body = JSON.stringify({
    req_key: "jimeng_i2i_seed3_tilesr_cvtob",
    image_urls: ["https://example.com/image.png"],
    resolution: "4k",
  });
  const signed = createVolcengineAuthorization({
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "SECRETEXAMPLE",
    host: "visual.volcengineapi.com",
    action: "CVSync2AsyncSubmitTask",
    body,
    date: new Date("2026-09-16T08:09:10.000Z"),
  });

  assert.deepEqual(signed, {
    authorization: "HMAC-SHA256 Credential=AKIDEXAMPLE/20260916/cn-north-1/cv/request, SignedHeaders=content-type;host;x-date, Signature=171a0eb3b3f9301c17cc538402914c3755fb2eafbbd726a7e7ba9803ee32b5cb",
    query: "Action=CVSync2AsyncSubmitTask&Version=2022-08-31",
    xDate: "20260916T080910Z",
  });
});

test("creates an OSS image URL submission payload", () => {
  assert.deepEqual(createImageUpscaleSubmitPayload("https://example.oss-cn-beijing.aliyuncs.com/source.png?signature=test", "8k"), {
    req_key: "jimeng_i2i_seed3_tilesr_cvtob",
    image_urls: ["https://example.oss-cn-beijing.aliyuncs.com/source.png?signature=test"],
    resolution: "8k",
  });
});
