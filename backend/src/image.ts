import { updateEnvFile } from "./llm.js";

export type ImageProvider = "volcengine" | "aliyun" | "openai" | "custom";
export type ImageResolution = "2K" | "4K";
export type ImageAspectRatio = "1:1" | "16:9" | "9:16" | "3:2" | "2:3" | "4:3" | "3:4";

const defaultImageModel = "doubao-seedream-5-0-pro-260628";
const deprecatedSeedanceModels = new Set([
  "doubao-seedance-2-5-260628",
  "doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-mini-260615",
  "doubao-seedance-2-0-fast-260128",
]);

const imageSizes: Record<ImageResolution, Record<ImageAspectRatio, string>> = {
  "2K": { "1:1": "2048x2048", "16:9": "2560x1440", "9:16": "1440x2560", "3:2": "2160x1440", "2:3": "1440x2160", "4:3": "2048x1536", "3:4": "1536x2048" },
  "4K": { "1:1": "4096x4096", "16:9": "4096x2304", "9:16": "2304x4096", "3:2": "3840x2560", "2:3": "2560x3840", "4:3": "4096x3072", "3:4": "3072x4096" },
};

const providerDefaults: Record<ImageProvider, string> = {
  volcengine: "https://ark.cn-beijing.volces.com/api/v3",
  aliyun: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  openai: "https://api.openai.com/v1",
  custom: "http://localhost:8000/v1",
};

let runtimeProvider = normalizeProvider(process.env.IMAGE_PROVIDER);
let runtimeApiKey = cleanKey(process.env.IMAGE_API_KEY);
const configuredModel = process.env.IMAGE_MODEL?.trim();
let runtimeModel = !configuredModel || deprecatedSeedanceModels.has(configuredModel) ? defaultImageModel : configuredModel;
let runtimeApiBase = (process.env.IMAGE_API_BASE?.trim() || providerDefaults[runtimeProvider]).replace(/\/$/, "");

function normalizeProvider(value: unknown): ImageProvider {
  return value === "aliyun" || value === "openai" || value === "custom" ? value : "volcengine";
}

function cleanKey(value: unknown) {
  if (typeof value !== "string") return undefined;
  const key = value.trim();
  if (!key || /^your(?:_|-).*(?:_|-)api(?:_|-)key$/i.test(key)) return undefined;
  return key;
}

function generationEndpoint(apiBase: string) {
  return /\/images\/generations\/?$/i.test(apiBase) ? apiBase : `${apiBase}/images/generations`;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function firstRecord(value: unknown) {
  return Array.isArray(value) ? record(value[0]) : undefined;
}

type ImageSource = { kind: "url"; value: string } | { kind: "base64"; value: string };

function getImageSource(payload: JsonRecord): ImageSource | null {
  const output = record(payload.output);
  const candidate = firstRecord(payload.data)
    ?? firstRecord(payload.images)
    ?? firstRecord(output?.results)
    ?? firstRecord(output?.images);
  if (!candidate) return null;
  const url = candidate.url ?? candidate.image_url ?? candidate.imageUrl;
  const base64 = candidate.b64_json ?? candidate.b64 ?? candidate.base64;
  if (typeof url === "string" && url.trim()) return { kind: "url", value: url.trim() };
  if (typeof base64 === "string" && base64.trim()) return { kind: "base64", value: base64.trim() };
  return null;
}

function mimeFromBytes(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "image/png";
}

function decodeBase64(value: string) {
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is);
  const bytes = Buffer.from(match?.[2] ?? value, "base64");
  return { bytes, mimeType: match?.[1]?.toLowerCase() ?? mimeFromBytes(bytes) };
}

export function getImageSettings() {
  return {
    provider: runtimeProvider,
    model: runtimeModel,
    apiBase: runtimeApiBase,
    configured: Boolean(runtimeApiKey),
  };
}

export function configureImage(input: { provider?: ImageProvider; apiKey?: string; model?: string; apiBase?: string }) {
  if (input.provider) runtimeProvider = input.provider;
  if (input.apiKey !== undefined) runtimeApiKey = cleanKey(input.apiKey);
  if (input.model) runtimeModel = input.model.trim();
  if (input.apiBase) runtimeApiBase = input.apiBase.trim().replace(/\/$/, "");
  updateEnvFile({
    IMAGE_PROVIDER: runtimeProvider,
    IMAGE_API_KEY: runtimeApiKey ?? "",
    IMAGE_MODEL: runtimeModel,
    IMAGE_API_BASE: runtimeApiBase,
  });
  return getImageSettings();
}

export const imageConfig = {
  get provider() { return runtimeProvider; },
  get model() { return runtimeModel; },
  get enabled() { return Boolean(runtimeApiKey); },
};

export class ImageGenerationService {
  get enabled() { return Boolean(runtimeApiKey); }

  async generate(input: { prompt: string; model?: string; resolution: ImageResolution; aspectRatio: ImageAspectRatio; referenceImage?: string; watermark?: boolean }) {
    if (!runtimeApiKey) throw new Error("尚未配置图片生成 API Key，请先打开模型设置");
    const model = input.model?.trim() || runtimeModel;
    const size = imageSizes[input.resolution][input.aspectRatio];
    let response: Response;
    try {
      response = await fetch(generationEndpoint(runtimeApiBase), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${runtimeApiKey}` },
        body: JSON.stringify({
          model,
          prompt: input.prompt,
          n: 1,
          size,
          response_format: "url",
          ...(input.referenceImage ? { image: input.referenceImage } : {}),
          ...(input.watermark !== undefined ? { watermark: input.watermark } : {}),
        }),
        signal: AbortSignal.timeout(300000),
      });
    } catch (error) {
      if (error && typeof error === "object" && (error as { name?: string }).name === "TimeoutError") {
        throw new Error("图片生成请求超过 5 分钟仍未完成，请稍后重试");
      }
      throw error;
    }

    const raw = await response.text();
    let payload: JsonRecord = {};
    try { payload = raw ? JSON.parse(raw) as JsonRecord : {}; }
    catch { /* The status error below includes the original response. */ }
    if (!response.ok) {
      const error = record(payload.error);
      const message = typeof error?.message === "string" ? error.message : raw.slice(0, 500);
      throw new Error(`图片平台 API ${response.status}: ${message || "请求失败"}`);
    }

    const source = getImageSource(payload);
    if (!source) {
      const taskId = payload.id ?? record(payload.output)?.task_id ?? record(payload.output)?.taskId;
      if (taskId) throw new Error("当前模型返回了异步任务而不是图片。请改用支持 /images/generations 同步返回图片的模型");
      throw new Error("图片平台没有返回可用的图片地址或 Base64 内容");
    }

    if (source.kind === "base64") return { ...decodeBase64(source.value), model, size };
    let imageResponse: Response;
    try { imageResponse = await fetch(source.value, { signal: AbortSignal.timeout(60000) }); }
    catch (error) {
      if (error && typeof error === "object" && (error as { name?: string }).name === "TimeoutError") throw new Error("下载生成图片超时，请重新生成");
      throw error;
    }
    if (!imageResponse.ok) throw new Error(`下载生成图片失败（HTTP ${imageResponse.status}）`);
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    const responseMime = imageResponse.headers.get("content-type")?.split(";")[0].toLowerCase();
    return { bytes, mimeType: responseMime?.startsWith("image/") ? responseMime : mimeFromBytes(bytes), model, size };
  }
}
