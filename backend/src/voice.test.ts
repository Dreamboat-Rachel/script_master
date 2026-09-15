import assert from "node:assert/strict";
import test from "node:test";
import { MiniMaxVoiceCloneService } from "./voice.js";

test("uploads the sample before submitting the MiniMax voice clone payload", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.MINIMAX_API_KEY;
  const originalApiBase = process.env.MINIMAX_API_BASE;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  process.env.MINIMAX_API_KEY = "test-token";
  process.env.MINIMAX_API_BASE = "https://minimax.test/v1";
  globalThis.fetch = (async (input: string | URL | globalThis.Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/files/upload")) {
      const form = init?.body as FormData;
      assert.equal(form.get("purpose"), "voice_clone");
      assert.ok(form.get("file") instanceof Blob);
      return new Response(JSON.stringify({ file: { file_id: 123456789 }, base_resp: { status_code: 0, status_msg: "success" } }));
    }
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body, {
      file_id: 123456789,
      voice_id: "script_master_test_voice",
      clone_prompt: { prompt_audio: 123456789, prompt_text: "测试样本文本。" },
      text: "这是克隆声音的试听文本。",
      model: "speech-2.8-hd",
      text_validation: "测试样本文本。",
      accuracy: 0.7,
      need_noise_reduction: false,
      need_volume_normalization: false,
      aigc_watermark: false,
    });
    return new Response(JSON.stringify({ demo_audio: "data:audio/mpeg;base64,SUQz", base_resp: { status_code: 0, status_msg: "success" } }));
  }) as typeof fetch;

  try {
    const service = new MiniMaxVoiceCloneService();
    const result = await service.clone({
      file: new Blob(["voice"], { type: "audio/wav" }),
      fileName: "reference.wav",
      voiceId: "script_master_test_voice",
      previewText: "这是克隆声音的试听文本。",
      sampleText: "测试样本文本。",
    });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].init?.headers instanceof Object, true);
    assert.equal(requests[1].url, "https://minimax.test/v1/voice_clone");
    assert.equal(result.demoAudio, "data:audio/mpeg;base64,SUQz");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = originalApiKey;
    if (originalApiBase === undefined) delete process.env.MINIMAX_API_BASE;
    else process.env.MINIMAX_API_BASE = originalApiBase;
  }
});

test("submits text-to-speech settings and decodes MiniMax hex audio", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.MINIMAX_API_KEY;
  const originalApiBase = process.env.MINIMAX_API_BASE;
  process.env.MINIMAX_API_KEY = "test-token";
  process.env.MINIMAX_API_BASE = "https://minimax.test/v1";
  globalThis.fetch = (async (input: string | URL | globalThis.Request, init?: RequestInit) => {
    assert.equal(String(input), "https://minimax.test/v1/t2a_v2");
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body, {
      model: "speech-2.8-hd",
      text: "这是需要合成的文本。",
      stream: false,
      voice_setting: { voice_id: "female-shaonv", speed: 1.1, vol: 1.2, pitch: 2, emotion: "happy" },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
      language_boost: "Chinese",
      output_format: "hex",
    });
    return new Response(JSON.stringify({ data: { audio: "494433" }, extra_info: { audio_length: 1234 }, base_resp: { status_code: 0, status_msg: "success" } }));
  }) as typeof fetch;

  try {
    const service = new MiniMaxVoiceCloneService();
    const result = await service.synthesize({
      text: "这是需要合成的文本。", voiceId: "female-shaonv", speed: 1.1, volume: 1.2, pitch: 2,
      emotion: "happy", languageBoost: "Chinese", format: "mp3", sampleRate: 32000,
    });
    assert.equal(result.audio.toString("hex"), "494433");
    assert.equal(result.durationMs, 1234);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = originalApiKey;
    if (originalApiBase === undefined) delete process.env.MINIMAX_API_BASE;
    else process.env.MINIMAX_API_BASE = originalApiBase;
  }
});
