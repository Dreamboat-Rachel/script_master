import { createHash, createHmac } from "node:crypto";

export type ImageUpscaleResolution = "4k" | "8k";

const reqKey = "jimeng_i2i_seed3_tilesr_cvtob";
const defaultEndpoint = "https://visual.volcengineapi.com";
const defaultRegion = "cn-north-1";
const defaultService = "cv";
const apiVersion = "2022-08-31";

const runtimeAccessKeyId = cleanCredential(process.env.VOLCENGINE_VISUAL_ACCESS_KEY_ID);
const runtimeSecretAccessKey = cleanCredential(process.env.VOLCENGINE_VISUAL_SECRET_ACCESS_KEY);
const runtimeEndpoint = cleanUrl(process.env.VOLCENGINE_VISUAL_ENDPOINT) || defaultEndpoint;

type JsonRecord = Record<string, unknown>;

function cleanCredential(value: unknown) {
  if (typeof value !== "string") return undefined;
  const credential = value.trim();
  if (!credential || /^your(?:_|-)/i.test(credential)) return undefined;
  return credential;
}

function cleanUrl(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/$/, "");
}

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function rfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalQuery(entries: Record<string, string>) {
  return Object.entries(entries)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`)
    .join("&");
}

function volcDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

export function createVolcengineAuthorization(input: {
  accessKeyId: string;
  secretAccessKey: string;
  host: string;
  action: string;
  body: string;
  date: Date;
  region?: string;
  service?: string;
}) {
  const region = input.region ?? defaultRegion;
  const service = input.service ?? defaultService;
  const xDate = volcDate(input.date);
  const shortDate = xDate.slice(0, 8);
  const query = canonicalQuery({ Action: input.action, Version: apiVersion });
  const signedHeaders = "content-type;host;x-date";
  const canonicalHeaders = `content-type:application/json\nhost:${input.host}\nx-date:${xDate}\n`;
  const canonicalRequest = ["POST", "/", query, canonicalHeaders, signedHeaders, sha256(input.body)].join("\n");
  const credentialScope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = ["HMAC-SHA256", xDate, credentialScope, sha256(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(input.secretAccessKey, shortDate), region), service), "request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  return {
    authorization: `HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    query,
    xDate,
  };
}

function providerMessage(payload: JsonRecord, fallback: string) {
  const error = record(payload.error);
  const responseMetadata = record(payload.ResponseMetadata);
  const metadataError = record(responseMetadata?.Error);
  return [payload.message, payload.Message, error?.message, metadataError?.Message]
    .find((value): value is string => typeof value === "string" && Boolean(value.trim())) ?? fallback;
}

function parseEmbeddedJson(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try { return record(JSON.parse(value)); }
  catch { return undefined; }
}

function firstString(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === "string" && Boolean(item.trim()))?.trim();
  return undefined;
}

function resultUrl(payload: JsonRecord) {
  const data = record(payload.data);
  const embedded = parseEmbeddedJson(data?.resp_data) ?? parseEmbeddedJson(data?.respData) ?? parseEmbeddedJson(payload.resp_data);
  const output = record(data?.output) ?? record(embedded?.output);
  return firstString(data?.image_urls)
    ?? firstString(data?.image_url)
    ?? firstString(data?.result_urls)
    ?? firstString(data?.result_url)
    ?? firstString(output?.image_urls)
    ?? firstString(output?.image_url)
    ?? firstString(embedded?.image_urls)
    ?? firstString(embedded?.image_url)
    ?? firstString(embedded?.result_urls)
    ?? firstString(embedded?.result_url);
}

function taskStatus(payload: JsonRecord) {
  const data = record(payload.data);
  return String(data?.status ?? data?.task_status ?? payload.status ?? "").trim().toLowerCase();
}

export function createImageUpscaleSubmitPayload(imageUrl: string, resolution: ImageUpscaleResolution) {
  return {
    req_key: reqKey,
    image_urls: [imageUrl],
    resolution,
  };
}

export class VolcengineImageUpscaleService {
  get enabled() { return Boolean(runtimeAccessKeyId && runtimeSecretAccessKey); }

  private async request(action: "CVSync2AsyncSubmitTask" | "CVSync2AsyncGetResult", payload: JsonRecord) {
    if (!runtimeAccessKeyId || !runtimeSecretAccessKey) throw new Error("尚未配置火山视觉 AccessKey 和 SecretKey");
    const endpoint = new URL(runtimeEndpoint);
    const body = JSON.stringify(payload);
    const signed = createVolcengineAuthorization({
      accessKeyId: runtimeAccessKeyId,
      secretAccessKey: runtimeSecretAccessKey,
      host: endpoint.host,
      action,
      body,
      date: new Date(),
    });
    const url = `${endpoint.origin}${endpoint.pathname === "/" ? "" : endpoint.pathname}?${signed.query}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: signed.authorization,
          "Content-Type": "application/json",
          Host: endpoint.host,
          "X-Date": signed.xDate,
        },
        body,
        signal: AbortSignal.timeout(60000),
      });
    } catch (error) {
      if (error && typeof error === "object" && (error as { name?: string }).name === "TimeoutError") throw new Error("图片高清平台请求超时，请稍后重试");
      throw error;
    }
    const raw = await response.text();
    let result: JsonRecord = {};
    try { result = raw ? JSON.parse(raw) as JsonRecord : {}; }
    catch { throw new Error(`图片高清平台返回了无效响应（HTTP ${response.status}）`); }
    const code = result.code ?? result.Code;
    if (!response.ok || (typeof code === "number" && code !== 0 && code !== 10000)) {
      throw new Error(`图片高清平台 API ${response.status}: ${providerMessage(result, "请求失败")}`);
    }
    return result;
  }

  async submit(imageUrl: string, resolution: ImageUpscaleResolution) {
    const payload = await this.request("CVSync2AsyncSubmitTask", createImageUpscaleSubmitPayload(imageUrl, resolution));
    const data = record(payload.data);
    const taskId = data?.task_id ?? data?.taskId ?? payload.task_id ?? payload.taskId;
    if (typeof taskId !== "string" || !taskId.trim()) throw new Error("图片高清平台没有返回任务 ID");
    return taskId.trim();
  }

  async query(taskId: string) {
    const payload = await this.request("CVSync2AsyncGetResult", {
      req_key: reqKey,
      task_id: taskId,
      req_json: JSON.stringify({
        return_url: true,
        logo_info: { add_logo: false, position: 0, language: 0, opacity: 1, logo_text_content: "" },
      }),
    });
    const status = taskStatus(payload);
    const url = resultUrl(payload);
    if (url) return { status: "completed" as const, url };
    if (["failed", "fail", "error", "expired", "cancelled", "canceled"].includes(status)) {
      throw new Error(providerMessage(payload, "图片高清任务处理失败"));
    }
    return { status: "processing" as const };
  }

  async generate(imageUrl: string, resolution: ImageUpscaleResolution) {
    const taskId = await this.submit(imageUrl, resolution);
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2500));
      const result = await this.query(taskId);
      if (result.status === "completed") return { taskId, imageUrl: result.url };
    }
    throw new Error("图片高清任务超过 8 分钟仍未完成，请稍后重试");
  }
}
