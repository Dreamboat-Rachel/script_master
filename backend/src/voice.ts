const DEFAULT_API_BASE = "https://api.minimax.cn/v1";
const DEFAULT_MODEL = "speech-2.8-hd";

type JsonRecord = Record<string, unknown>;

export interface MiniMaxVoiceCloneInput {
  file: Blob;
  fileName: string;
  voiceId: string;
  previewText: string;
  sampleText?: string;
}

export interface MiniMaxVoiceCloneOutput {
  fileId: string;
  demoAudio: string;
  model: string;
}

export interface MiniMaxSpeechInput {
  text: string;
  voiceId: string;
  speed: number;
  volume: number;
  pitch: number;
  emotion: "neutral" | "happy" | "sad" | "angry" | "fearful" | "surprised";
  languageBoost: "Chinese" | "Chinese,Yue" | "English" | "Japanese";
  format: "mp3" | "flac";
  sampleRate: 32000 | 44100;
}

export interface MiniMaxSpeechOutput {
  audio: Buffer;
  durationMs: number | null;
  model: string;
}

function cleanApiKey(value: string | undefined) {
  const cleaned = value?.trim().replace(/^Bearer\s+/i, "");
  return cleaned && !/^your[_-]/i.test(cleaned) ? cleaned : undefined;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function decodeAudio(value: string) {
  const dataUrl = value.match(/^data:audio\/[a-z0-9.+-]+;base64,(.+)$/i);
  if (dataUrl) return Buffer.from(dataUrl[1], "base64");
  if (/^[0-9a-f]+$/i.test(value) && value.length % 2 === 0) return Buffer.from(value, "hex");
  return Buffer.from(value, "base64");
}

function assertMiniMaxSuccess(payload: unknown, action: string) {
  const root = asRecord(payload);
  const baseResponse = asRecord(root?.base_resp ?? root?.baseResp);
  const statusCode = baseResponse?.status_code ?? baseResponse?.statusCode;
  if (statusCode !== undefined && Number(statusCode) !== 0) {
    const message = readString(baseResponse?.status_msg ?? baseResponse?.statusMsg) ?? `状态码 ${String(statusCode)}`;
    throw new Error(`MiniMax ${action}失败：${message}`);
  }
}

async function parseResponse(response: globalThis.Response, action: string) {
  const raw = await response.text();
  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`MiniMax ${action}返回了无效响应（HTTP ${response.status}）`);
  }
  if (!response.ok) {
    const root = asRecord(payload);
    const baseResponse = asRecord(root?.base_resp ?? root?.baseResp);
    const message = readString(root?.message ?? root?.error ?? baseResponse?.status_msg ?? baseResponse?.statusMsg);
    throw new Error(`MiniMax ${action}失败（HTTP ${response.status}）${message ? `：${message}` : ""}`);
  }
  assertMiniMaxSuccess(payload, action);
  return payload;
}

export class MiniMaxVoiceCloneService {
  private readonly apiKey = cleanApiKey(process.env.MINIMAX_API_KEY);
  private readonly apiBase = (process.env.MINIMAX_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/$/, "");
  readonly model = process.env.MINIMAX_VOICE_MODEL?.trim() || DEFAULT_MODEL;

  get enabled() {
    return Boolean(this.apiKey);
  }

  async clone(input: MiniMaxVoiceCloneInput): Promise<MiniMaxVoiceCloneOutput> {
    if (!this.apiKey) throw new Error("尚未配置 MINIMAX_API_KEY");

    const uploadForm = new FormData();
    uploadForm.append("purpose", "voice_clone");
    uploadForm.append("file", input.file, input.fileName);
    const uploadResponse = await fetch(`${this.apiBase}/files/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: uploadForm,
      signal: AbortSignal.timeout(120_000),
    });
    const uploadPayload = await parseResponse(uploadResponse, "文件上传");
    const uploadRoot = asRecord(uploadPayload);
    const uploadFile = asRecord(uploadRoot?.file);
    const uploadData = asRecord(uploadRoot?.data);
    const fileIdValue = uploadFile?.file_id ?? uploadFile?.fileId ?? uploadData?.file_id ?? uploadData?.fileId ?? uploadRoot?.file_id ?? uploadRoot?.fileId;
    if (typeof fileIdValue !== "number" && typeof fileIdValue !== "string") {
      throw new Error("MiniMax 文件上传成功，但响应中缺少 file_id");
    }

    const fileId = fileIdValue;
    const sampleText = input.sampleText?.trim();
    const cloneBody: JsonRecord = {
      file_id: fileId,
      voice_id: input.voiceId,
      text: input.previewText,
      model: this.model,
      accuracy: 0.7,
      need_noise_reduction: false,
      need_volume_normalization: false,
      aigc_watermark: false,
    };
    if (sampleText) {
      cloneBody.clone_prompt = { prompt_audio: fileId, prompt_text: sampleText };
      cloneBody.text_validation = sampleText;
    }

    const cloneResponse = await fetch(`${this.apiBase}/voice_clone`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cloneBody),
      signal: AbortSignal.timeout(180_000),
    });
    const clonePayload = await parseResponse(cloneResponse, "声音克隆");
    const cloneRoot = asRecord(clonePayload);
    const cloneData = asRecord(cloneRoot?.data);
    const demoAudio = readString(cloneRoot?.demo_audio ?? cloneRoot?.demoAudio ?? cloneData?.demo_audio ?? cloneData?.demoAudio);
    if (!demoAudio) throw new Error("MiniMax 声音克隆成功，但响应中缺少试听音频");

    return { fileId: String(fileIdValue), demoAudio, model: this.model };
  }

  async synthesize(input: MiniMaxSpeechInput): Promise<MiniMaxSpeechOutput> {
    if (!this.apiKey) throw new Error("尚未配置 MINIMAX_API_KEY");
    const response = await fetch(`${this.apiBase}/t2a_v2`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        text: input.text,
        stream: false,
        voice_setting: {
          voice_id: input.voiceId,
          speed: input.speed,
          vol: input.volume,
          pitch: input.pitch,
          emotion: input.emotion,
        },
        audio_setting: {
          sample_rate: input.sampleRate,
          bitrate: 128000,
          format: input.format,
          channel: 1,
        },
        language_boost: input.languageBoost,
        output_format: "hex",
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const payload = await parseResponse(response, "语音合成");
    const root = asRecord(payload);
    const data = asRecord(root?.data);
    const extraInfo = asRecord(root?.extra_info ?? root?.extraInfo ?? data?.extra_info ?? data?.extraInfo);
    const audioValue = readString(data?.audio ?? root?.audio);
    if (!audioValue) throw new Error("MiniMax 语音合成成功，但响应中缺少音频数据");
    const audio = decodeAudio(audioValue);
    if (!audio.length) throw new Error("MiniMax 语音合成返回了空音频");
    const audioLength = Number(extraInfo?.audio_length ?? extraInfo?.audioLength);
    return {
      audio,
      durationMs: Number.isFinite(audioLength) && audioLength > 0 ? audioLength : null,
      model: this.model,
    };
  }
}
