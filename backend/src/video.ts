import { updateEnvFile } from "./llm.js";

export type VideoProvider = "volcengine" | "aliyun" | "openai" | "custom";
export type VideoModel = "doubao-seedance-2-0-mini-260615" | "doubao-seedance-2-0-260128" | "doubao-seedance-2-0-fast-260128";
export type VideoTaskStatus = "queued" | "processing" | "completed" | "failed";

export const videoModelOptions = [
  "doubao-seedance-2-0-mini-260615",
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
let runtimeModel: VideoModel = videoModelOptions.includes(configuredModel as VideoModel) ? configuredModel as VideoModel : videoModelOptions[0];
let runtimeApiBase = (process.env.VIDEO_API_BASE?.trim() || process.env.IMAGE_API_BASE?.trim() || providerDefaults[runtimeProvider]).replace(/\/$/, "");

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function taskEndpoint(apiBase: string) {
  const base = apiBase.replace(/\/$/, "");
  return /\/contents\/generations\/tasks$/i.test(base) ? base : `${base}/contents/generations/tasks`;
}

function normalizeTaskStatus(value: unknown): VideoTaskStatus {
  const status = String(value ?? "").toLowerCase();
  if (["succeeded", "success", "completed", "complete", "done"].includes(status)) return "completed";
  if (["failed", "failure", "error", "cancelled", "canceled"].includes(status)) return "failed";
  if (["running", "processing", "in_progress", "in-progress"].includes(status)) return "processing";
  return "queued";
}

function findTaskId(payload: Record<string, unknown>) {
  const output = record(payload.output);
  const id = payload.id ?? payload.task_id ?? payload.taskId ?? output?.id ?? output?.task_id ?? output?.taskId;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

function findStatus(payload: Record<string, unknown>): VideoTaskStatus {
  const output = record(payload.output);
  return normalizeTaskStatus(payload.status ?? payload.task_status ?? payload.taskStatus ?? output?.status ?? output?.task_status ?? output?.taskStatus);
}

function findProgress(payload: Record<string, unknown>, status: VideoTaskStatus) {
  const output = record(payload.output);
  const raw = payload.progress ?? output?.progress;
  const progress = typeof raw === "number" ? raw : Number(raw);
  if (Number.isFinite(progress)) return Math.max(0, Math.min(100, Math.round(progress)));
  return status === "completed" ? 100 : status === "processing" ? 50 : 3;
}

function findVideoUrl(payload: Record<string, unknown>) {
  const scan = (value: unknown): string | undefined => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = scan(item);
        if (found) return found;
      }
      return undefined;
    }
    const item = record(value);
    if (!item) return undefined;
    const direct = item.video_url ?? item.videoUrl;
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    const nested = record(direct);
    if (nested && typeof nested.url === "string" && nested.url.trim()) return nested.url.trim();
    if (item.type === "video_url" && typeof item.url === "string" && item.url.trim()) return item.url.trim();
    for (const key of ["content", "output", "data", "result", "results"]) {
      const found = scan(item[key]);
      if (found) return found;
    }
    return undefined;
  };
  return scan(payload);
}

function findError(payload: Record<string, unknown>) {
  const error = record(payload.error);
  const message = error?.message ?? payload.error_message ?? payload.message;
  return typeof message === "string" && message.trim() ? message.trim() : "视频平台任务失败";
}

export function getVideoSettings() {
  return { provider: runtimeProvider, model: runtimeModel, apiBase: runtimeApiBase, configured: Boolean(runtimeApiKey) };
}

export function configureVideo(input: { provider?: VideoProvider; apiKey?: string; model?: string; apiBase?: string }) {
  if (input.provider) runtimeProvider = input.provider;
  if (input.apiKey !== undefined) runtimeApiKey = cleanKey(input.apiKey);
  if (input.model && videoModelOptions.includes(input.model as VideoModel)) runtimeModel = input.model as VideoModel;
  if (input.apiBase) runtimeApiBase = input.apiBase.trim().replace(/\/$/, "");
  updateEnvFile({ VIDEO_PROVIDER: runtimeProvider, VIDEO_API_KEY: runtimeApiKey ?? "", VIDEO_MODEL: runtimeModel, VIDEO_API_BASE: runtimeApiBase });
  return getVideoSettings();
}

export const videoConfig = {
  get provider() { return runtimeProvider; },
  get model() { return runtimeModel; },
  get enabled() { return Boolean(runtimeApiKey); },
};

export class VideoGenerationService {
  get enabled() { return Boolean(runtimeApiKey); }

  private ensureConfigured() {
    if (!runtimeApiKey) throw new Error("尚未配置视频生成 API Key，请先打开模型设置");
    if (runtimeProvider !== "volcengine") throw new Error("当前视频接口仅支持火山方舟内容生成任务");
  }

  private async request(path: string, init: RequestInit) {
    this.ensureConfigured();
    let response: Response;
    try {
      response = await fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${runtimeApiKey}`, ...(init.headers ?? {}) },
        signal: init.signal ?? AbortSignal.timeout(60000),
      });
    } catch (error) {
      if (error && typeof error === "object" && (error as { name?: string }).name === "TimeoutError") throw new Error("视频平台请求超过 60 秒，请稍后重试");
      throw error;
    }
    const raw = await response.text();
    let payload: Record<string, unknown> = {};
    try { payload = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { /* The status error below includes the original response. */ }
    if (!response.ok) {
      const error = record(payload.error);
      const message = typeof error?.message === "string" ? error.message : raw.slice(0, 500);
      throw new Error(`视频平台 API ${response.status}: ${message || "请求失败"}`);
    }
    return payload;
  }

  async createTask(input: { prompt: string; model?: VideoModel; referenceImageUrls?: string[]; firstFrameUrl?: string; lastFrameUrl?: string; ratio: string; duration: number; generateAudio?: boolean; watermark?: boolean }) {
    const referenceItems = (input.referenceImageUrls ?? []).filter(Boolean).map((url) => ({ type: "image_url", image_url: { url }, role: "reference_image" }));
    const firstFrameItem = input.firstFrameUrl ? { type: "image_url", image_url: { url: input.firstFrameUrl }, role: "first_frame" } : undefined;
    const lastFrameItem = input.lastFrameUrl ? { type: "image_url", image_url: { url: input.lastFrameUrl }, role: "last_frame" } : undefined;
    const frameItems = [firstFrameItem, lastFrameItem].filter(Boolean);
    const body = (withReferences: boolean, withFrames: boolean) => JSON.stringify({
      model: input.model ?? runtimeModel,
      content: [
        { type: "text", text: input.prompt },
        ...(withFrames ? frameItems : []),
        ...(withReferences ? referenceItems : []),
      ],
      generate_audio: input.generateAudio ?? true,
      ratio: input.ratio,
      duration: Math.max(2, Math.min(12, Math.round(input.duration))),
      watermark: input.watermark ?? false,
    });
    // Seedance rejects first/last-frame media mixed with reference media. A real
    // first frame is the stronger continuity constraint, so it takes priority.
    let referenceFallback = Boolean(frameItems.length && referenceItems.length);
    let continuityFrameFallback = false;
    let payload: Record<string, unknown>;
    try {
      payload = await this.request(taskEndpoint(runtimeApiBase), { method: "POST", body: body(!frameItems.length, true) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/(real person|真人|真实人物|may contain real)/i.test(message)) throw error;
      if (frameItems.length) {
        continuityFrameFallback = true;
        if (!referenceItems.length) {
          payload = await this.request(taskEndpoint(runtimeApiBase), { method: "POST", body: body(false, false) });
        } else {
          referenceFallback = false;
          try {
            payload = await this.request(taskEndpoint(runtimeApiBase), { method: "POST", body: body(true, false) });
          } catch (retryError) {
            const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
            if (!/(real person|真人|真实人物|may contain real)/i.test(retryMessage)) throw retryError;
            referenceFallback = true;
            payload = await this.request(taskEndpoint(runtimeApiBase), { method: "POST", body: body(false, false) });
          }
        }
      } else if (referenceItems.length) {
        referenceFallback = true;
        payload = await this.request(taskEndpoint(runtimeApiBase), { method: "POST", body: body(false, false) });
      } else {
        throw error;
      }
    }
    const taskId = findTaskId(payload);
    if (!taskId) throw new Error("视频平台没有返回任务 ID");
    const status = findStatus(payload);
    return { taskId, status, progress: findProgress(payload, status), videoUrl: findVideoUrl(payload), referenceFallback, continuityFrameFallback };
  }

  async getTask(taskId: string) {
    const payload = await this.request(`${taskEndpoint(runtimeApiBase)}/${encodeURIComponent(taskId)}`, { method: "GET" });
    const status = findStatus(payload);
    return { status, progress: findProgress(payload, status), videoUrl: findVideoUrl(payload), errorMessage: status === "failed" ? findError(payload) : undefined };
  }
}
