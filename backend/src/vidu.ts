const defaultApiBase = "https://api.vidu.cn";
const defaultWsBase = "wss://api.vidu.cn";
const defaultVideoCreateTimeoutMs = 300_000;
const defaultAudioCreateTimeoutMs = 120_000;

function cleanValue(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
}

function cleanCredential(value: unknown) {
  const credential = cleanValue(value);
  if (!credential || /^your(?:_|-)/i.test(credential)) return "";
  return credential;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveTimeout(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 10_000 ? Math.round(parsed) : fallback;
}

export function viduLiveCreateTimeoutMs(callMode: "audio" | "video", env: NodeJS.ProcessEnv = process.env) {
  return callMode === "video"
    ? positiveTimeout(env.VIDU_VIDEO_CREATE_TIMEOUT_MS, defaultVideoCreateTimeoutMs)
    : positiveTimeout(env.VIDU_AUDIO_CREATE_TIMEOUT_MS, defaultAudioCreateTimeoutMs);
}

export function viduLiveErrorMessage(payload: unknown, status: number) {
  const body = record(payload);
  const message = text(body?.message) || text(body?.error) || text(record(body?.error)?.message);
  if (/insufficient\s+(credits?|balance)|credits?\s+exhausted|quota\s+exceeded/i.test(message)) {
    return "Vidu Live 账户额度不足，请前往 Vidu 平台充值或补充额度";
  }
  if (/unauthorized|invalid\s+(api[ _-]?key|token)|authentication/i.test(message)) {
    return "Vidu Live API Key 无效，请检查后台配置";
  }
  return message ? `Vidu Live 请求失败：${message}` : `Vidu Live 请求失败（HTTP ${status}）`;
}

export interface ViduLiveSession {
  liveId: string;
  rtc: {
    token: string;
    userId: string;
  };
  raw: Record<string, unknown>;
}

export class ViduLiveService {
  private readonly apiKey = cleanCredential(process.env.VIDU_API_KEY);
  private readonly apiBase = cleanValue(process.env.VIDU_API_BASE) || defaultApiBase;
  private readonly wsBase = cleanValue(process.env.VIDU_WS_BASE) || defaultWsBase;

  get enabled() {
    return Boolean(this.apiKey);
  }

  get controlBaseUrl() {
    return this.wsBase;
  }

  get authorizationHeader() {
    if (!this.apiKey) throw new Error("Vidu Live 尚未配置，请在 backend/.env 中填写 VIDU_API_KEY");
    return `Token ${this.apiKey}`;
  }

  async createRealtimeSession(input: { callMode: "audio" | "video"; persona: string; imageUri: string; voice: string }) {
    if (!this.enabled) throw new Error("Vidu Live 尚未配置，请在 backend/.env 中填写 VIDU_API_KEY");
    const timeoutMs = viduLiveCreateTimeoutMs(input.callMode);
    let response: Response;
    try {
      response = await fetch(`${this.apiBase}/live/s_avatar/realtime`, {
        method: "POST",
        headers: {
          Authorization: this.authorizationHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          model: "vidu-s2",
          call_mode: input.callMode,
          avatar: {
            persona: input.persona,
            image_uri: input.imageUri,
            voice: input.voice,
          },
          idle_motion: {
            enabled: true,
            source: "default",
            recommend: "random",
            scheduling: {
              motion_interval: 12,
              rest_after_motion: 4,
            },
          },
          action: {
            enabled: true,
            library_id: "0",
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const detail = error instanceof Error ? `${error.name} ${error.message}` : String(error);
      if (/timeout|timed out|aborted due to timeout/i.test(detail)) {
        const minutes = Math.round(timeoutMs / 60_000);
        const mode = input.callMode === "video" ? "视频" : "语音";
        throw new Error(`Vidu Live ${mode}会话创建请求超过 ${minutes} 分钟仍未完成，请稍后重试`);
      }
      throw error;
    }
    const rawText = await response.text();
    let payload: unknown = null;
    if (rawText.trim()) {
      try { payload = JSON.parse(rawText); }
      catch { throw new Error(`Vidu Live 返回了无效响应（HTTP ${response.status}）`); }
    }
    if (!response.ok) throw new Error(viduLiveErrorMessage(payload, response.status));
    return normalizeViduLiveSession(payload);
  }
}

export function normalizeViduLiveSession(payload: unknown): ViduLiveSession {
  const root = record(payload);
  const data = record(root?.data) ?? root;
  const live = record(data?.live);
  const rtc = record(data?.rtc);
  const rawLiveId = live?.id ?? data?.live_id;
  const liveId = typeof rawLiveId === "bigint" || typeof rawLiveId === "number" ? String(rawLiveId) : text(rawLiveId);
  const token = text(rtc?.token);
  const userId = text(rtc?.user_id ?? rtc?.userId);
  if (!data || !liveId || !token || !userId) {
    throw new Error("Vidu Live 响应缺少 live.id、rtc.token 或 rtc.user_id");
  }
  return { liveId, rtc: { token, userId }, raw: data };
}
