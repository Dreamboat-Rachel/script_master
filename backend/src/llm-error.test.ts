import assert from "node:assert/strict";
import test from "node:test";
import { deepSeekHttpErrorMessage } from "./llm.js";

test("translates DeepSeek insufficient balance responses", () => {
  const message = deepSeekHttpErrorMessage(402, '{"error":{"message":"Insufficient Balance"}}');
  assert.equal(message, "DeepSeek 账户余额不足，请充值后重试或在模型设置中更换可用的 API Key");
});

test("translates DeepSeek authentication and rate-limit responses", () => {
  assert.match(deepSeekHttpErrorMessage(401, "unauthorized"), /API Key 无效/);
  assert.match(deepSeekHttpErrorMessage(429, "rate limit"), /请求过于频繁/);
});

test("does not expose an upstream response body for generic errors", () => {
  const message = deepSeekHttpErrorMessage(400, "sensitive provider diagnostics");
  assert.equal(message, "DeepSeek 请求失败（HTTP 400），请检查模型名称和 API 地址");
  assert.doesNotMatch(message, /sensitive provider diagnostics/);
});
