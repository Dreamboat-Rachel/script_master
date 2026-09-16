import OSS from "ali-oss";
import { randomUUID } from "node:crypto";

const accessKeyId = cleanCredential(process.env.ALIYUN_OSS_ACCESS_KEY_ID);
const accessKeySecret = cleanCredential(process.env.ALIYUN_OSS_ACCESS_KEY_SECRET);
const securityToken = cleanCredential(process.env.ALIYUN_OSS_SECURITY_TOKEN);
const region = cleanValue(process.env.ALIYUN_OSS_REGION) || "oss-cn-beijing";
const bucket = cleanValue(process.env.ALIYUN_OSS_BUCKET);
const endpoint = cleanValue(process.env.ALIYUN_OSS_ENDPOINT) || "https://oss-cn-beijing.aliyuncs.com";
const objectPrefix = cleanValue(process.env.ALIYUN_OSS_OBJECT_PREFIX) || "script-master/upscale-inputs";

function cleanValue(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
}

function cleanCredential(value: unknown) {
  const credential = cleanValue(value);
  if (!credential || /^your(?:_|-)/i.test(credential)) return undefined;
  return credential;
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "未知错误";
}

export function createOssObjectName(mimeType: string, id: string = randomUUID(), now = new Date()) {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  const datePath = now.toISOString().slice(0, 10).replace(/-/g, "/");
  return `${objectPrefix}/${datePath}/${id}.${extension}`;
}

export class AliyunOssService {
  private client?: OSS;

  get enabled() {
    return Boolean(accessKeyId && accessKeySecret && bucket);
  }

  private getClient() {
    if (!accessKeyId || !accessKeySecret || !bucket) {
      throw new Error("OSS 尚未配置，请在 backend/.env 中填写 ALIYUN_OSS_ACCESS_KEY_ID、ALIYUN_OSS_ACCESS_KEY_SECRET 和 ALIYUN_OSS_BUCKET");
    }
    this.client ??= new OSS({
      accessKeyId,
      accessKeySecret,
      ...(securityToken ? { stsToken: securityToken } : {}),
      bucket,
      region,
      endpoint,
      secure: true,
      timeout: 60000,
    });
    return this.client;
  }

  async uploadTemporaryImage(bytes: Buffer, mimeType: string) {
    const client = this.getClient();
    const objectName = createOssObjectName(mimeType);
    try {
      await client.put(objectName, bytes, {
        mime: mimeType,
        headers: { "Cache-Control": "no-store" },
      });
      const url = client.signatureUrl(objectName, { method: "GET", expires: 60 * 60 });
      return { objectName, url };
    } catch (error) {
      throw new Error(`OSS 上传失败：${errorMessage(error)}`);
    }
  }

  async deleteObject(objectName: string) {
    try {
      await this.getClient().delete(objectName);
    } catch (error) {
      throw new Error(`OSS 临时文件清理失败：${errorMessage(error)}`);
    }
  }
}
