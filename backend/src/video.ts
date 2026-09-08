import { updateEnvFile } from "./llm.js";

export type VideoProvider = "volcengine" | "aliyun" | "openai" | "custom";
export const videoModelOptions = [
  "doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-fast-260128",
] as const;

const providerDefaults: Record<VideoProvider, string> = {
  volcengine: "https://ark.cn-beijing.volces.com/api/v3",
  aliyun: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  openai: "https://api.openai.com/v1",
  custom: "http://localhost:8000/v1",
};

function normalizeProvider(value: unknown): VideoProvider {
  return value === "aliyun" || value === "openai" || value === "custom" ? value : "volcengine";
}

function cleanKey(value: unknown) {
  if (typeof value !== "string") return undefined;
  const key = value.trim();
  return key && !/^your(?:_|-).*(?:_|-)api(?:_|-)key$/i.test(key) ? key : undefined;
}

let runtimeProvider = normalizeProvider(process.env.VIDEO_PROVIDER ?? process.env.IMAGE_PROVIDER);
let runtimeApiKey = cleanKey(process.env.VIDEO_API_KEY) ?? cleanKey(process.env.IMAGE_API_KEY);
const configuredModel = process.env.VIDEO_MODEL?.trim();
let runtimeModel = videoModelOptions.includes(configuredModel as typeof videoModelOptions[number]) ? configuredModel! : videoModelOptions[0];
let runtimeApiBase = (process.env.VIDEO_API_BASE?.trim() || process.env.IMAGE_API_BASE?.trim() || providerDefaults[runtimeProvider]).replace(/\/$/, "");

export function getVideoSettings() {
  return { provider: runtimeProvider, model: runtimeModel, apiBase: runtimeApiBase, configured: Boolean(runtimeApiKey) };
}

export function configureVideo(input: { provider?: VideoProvider; apiKey?: string; model?: string; apiBase?: string }) {
  if (input.provider) runtimeProvider = input.provider;
  if (input.apiKey !== undefined) runtimeApiKey = cleanKey(input.apiKey);
  if (input.model && videoModelOptions.includes(input.model as typeof videoModelOptions[number])) runtimeModel = input.model as typeof videoModelOptions[number];
  if (input.apiBase) runtimeApiBase = input.apiBase.trim().replace(/\/$/, "");
  updateEnvFile({ VIDEO_PROVIDER: runtimeProvider, VIDEO_API_KEY: runtimeApiKey ?? "", VIDEO_MODEL: runtimeModel, VIDEO_API_BASE: runtimeApiBase });
  return getVideoSettings();
}

