import assert from "node:assert/strict";
import test from "node:test";
import { normalizeViduLiveSession, ViduLiveService, viduLiveCreateTimeoutMs, viduLiveErrorMessage } from "./vidu.js";

test("normalizes a Vidu realtime live response and preserves int64 IDs as strings", () => {
  const session = normalizeViduLiveSession({
    live: { id: "1234567890123456789" },
    rtc: { token: "rtc-token", user_id: "user-1" },
  });
  assert.equal(session.liveId, "1234567890123456789");
  assert.deepEqual(session.rtc, { token: "rtc-token", userId: "user-1" });
});

test("accepts a response wrapped in data", () => {
  const session = normalizeViduLiveSession({
    data: {
      live_id: "live-2",
      rtc: { token: "rtc-token", userId: "user-2" },
    },
  });
  assert.equal(session.liveId, "live-2");
});

test("rejects incomplete RTC responses", () => {
  assert.throws(() => normalizeViduLiveSession({ live: { id: "live-3" }, rtc: {} }), /rtc\.token/);
});

test("translates an insufficient credits response into an actionable message", () => {
  assert.equal(
    viduLiveErrorMessage({ message: "insufficient credits" }, 400),
    "Vidu Live 账户额度不足，请前往 Vidu 平台充值或补充额度",
  );
});

test("keeps other provider errors identifiable as Vidu Live errors", () => {
  assert.equal(
    viduLiveErrorMessage({ error: "avatar image is invalid" }, 400),
    "Vidu Live 请求失败：avatar image is invalid",
  );
});

test("uses longer configurable creation timeouts for video sessions", () => {
  assert.equal(viduLiveCreateTimeoutMs("video", {}), 300_000);
  assert.equal(viduLiveCreateTimeoutMs("audio", {}), 120_000);
  assert.equal(viduLiveCreateTimeoutMs("video", { VIDU_VIDEO_CREATE_TIMEOUT_MS: "420000" }), 420_000);
  assert.equal(viduLiveCreateTimeoutMs("video", { VIDU_VIDEO_CREATE_TIMEOUT_MS: "100" }), 300_000);
});

test("creates realtime sessions with the Vidu S2 model", async () => {
  const previousApiKey = process.env.VIDU_API_KEY;
  const previousFetch = globalThis.fetch;
  let requestBodyText = "";
  process.env.VIDU_API_KEY = "vda_test";
  globalThis.fetch = async (_input, init) => {
    requestBodyText = String(init?.body);
    return new Response(JSON.stringify({
      live: { id: "live-s2" },
      rtc: { token: "rtc-token", user_id: "rtc-user" },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const service = new ViduLiveService();
    await service.createRealtimeSession({ callMode: "video", persona: "友好的数字人", imageUri: "https://example.com/avatar.png", voice: "" });
    const requestBody = JSON.parse(requestBodyText) as Record<string, unknown>;
    assert.equal(requestBody.model, "vidu-s2");
    assert.equal(requestBody.call_mode, "video");
    assert.deepEqual(requestBody.idle_motion, {
      enabled: true,
      source: "default",
      recommend: "random",
      scheduling: { motion_interval: 12, rest_after_motion: 4 },
    });
    assert.deepEqual(requestBody.action, { enabled: true, library_id: "0" });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.VIDU_API_KEY;
    else process.env.VIDU_API_KEY = previousApiKey;
  }
});
