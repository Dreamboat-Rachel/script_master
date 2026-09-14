import "dotenv/config";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { appendFileSync, mkdirSync } from "node:fs";
import { readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { basename, resolve } from "node:path";
import { z } from "zod";
import { createDatabaseStore } from "./database.js";
import { configureImage, getImageSettings, imageConfig, ImageGenerationService } from "./image.js";
import { configureVideo, getVideoSettings, VideoGenerationService } from "./video.js";
import { configureDeepSeek, deepSeekConfig, DeepSeekService, getDeepSeekSettings, SCRIPT_GENERATION_INPUT_TOKEN_BUDGET, SCRIPT_GENERATION_OUTPUT_TOKEN_BUDGET } from "./llm.js";
import type { Project, RenderJob, Shot, Subject } from "./types.js";

const port = Number(process.env.PORT ?? 8787);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const databaseUrl = process.env.DATABASE_URL ?? "sqlite://./data/script-master.db";
const db = createDatabaseStore(databaseUrl);
const deepSeek = new DeepSeekService();
const imageGeneration = new ImageGenerationService();
const localFallback = process.env.LOCAL_FALLBACK === "true";
const logDirectory = resolve(process.cwd(), "logs");
const logFile = resolve(logDirectory, "backend.log");
const generatedDirectory = resolve(process.cwd(), "data", "generated");
const subjectImageDirectory = resolve(generatedDirectory, "subjects");
const characterImageDirectory = resolve(generatedDirectory, "characters");
const sceneImageDirectory = resolve(generatedDirectory, "scenes");
const propImageDirectory = resolve(generatedDirectory, "props");
const studioImageDirectories = { character: characterImageDirectory, scene: sceneImageDirectory, prop: propImageDirectory } as const;
const referenceVideoDirectory = resolve(generatedDirectory, "reference-videos");
const keyframeVideoDirectory = resolve(generatedDirectory, "keyframe-videos");
const studioVideoDirectories = { "reference-video": referenceVideoDirectory, "keyframe-video": keyframeVideoDirectory } as const;
const continuityFrameDirectory = resolve(generatedDirectory, "continuity");
const generatedVideoDirectory = resolve(generatedDirectory, "videos");
const videoMergeDirectory = resolve(generatedDirectory, "merges");
const projectCoverDirectory = resolve(generatedDirectory, "covers");
const videoGeneration = new VideoGenerationService();
const renderJobStreams = new Set<Response>();
const continuityFrameCache = new Map<string, string>();

type StudioVideoType = keyof typeof studioVideoDirectories;
type StudioVideoStatus = "queued" | "processing" | "completed" | "failed";
interface StoredStudioVideo {
  id: string;
  videoType: StudioVideoType;
  status: StudioVideoStatus;
  progress: number;
  outputUrl: string | null;
  errorMessage: string | null;
  prompt: string;
  model: "doubao-seedance-2-0-mini-260615" | "doubao-seedance-2-0-260128" | "doubao-seedance-2-0-fast-260128";
  ratio: "16:9" | "9:16" | "1:1";
  duration: number;
  createdAt: string;
  updatedAt: string;
  providerTaskId?: string;
}
const studioVideoTasks = new Map<string, StoredStudioVideo>();

mkdirSync(logDirectory, { recursive: true });
mkdirSync(subjectImageDirectory, { recursive: true });
mkdirSync(characterImageDirectory, { recursive: true });
mkdirSync(sceneImageDirectory, { recursive: true });
mkdirSync(propImageDirectory, { recursive: true });
mkdirSync(referenceVideoDirectory, { recursive: true });
mkdirSync(keyframeVideoDirectory, { recursive: true });
mkdirSync(continuityFrameDirectory, { recursive: true });
mkdirSync(generatedVideoDirectory, { recursive: true });
mkdirSync(videoMergeDirectory, { recursive: true });
mkdirSync(projectCoverDirectory, { recursive: true });

function writeLog(level: "INFO" | "WARN" | "ERROR", message: string, data?: Record<string, unknown>) {
  const line = `${new Date().toISOString()} [${level}] ${message}${data ? ` ${JSON.stringify(data)}` : ""}`;
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.info(line);
  try { appendFileSync(logFile, `${line}\n`, "utf8"); }
  catch (error) { console.error("[logger] 日志文件写入失败", error); }
}

const wait = (milliseconds: number) => new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds));

async function broadcastRenderJobs() {
  if (!renderJobStreams.size) return;
  const message = `data: ${JSON.stringify(await db.listJobs())}\n\n`;
  for (const stream of renderJobStreams) {
    try {
      stream.write(message);
    } catch {
      renderJobStreams.delete(stream);
    }
  }
}

async function localVideoStorageStats() {
  const names = await readdir(generatedVideoDirectory).catch(() => [] as string[]);
  const sizes = await Promise.all(names
    .filter((name) => name.toLowerCase().endsWith(".mp4"))
    .map((name) => stat(resolve(generatedVideoDirectory, name)).then((file) => file.isFile() ? file.size : 0).catch(() => 0)));
  return { videoCount: sizes.filter((size) => size > 0).length, bytes: sizes.reduce((total, size) => total + size, 0) };
}

function publicMediaUrl(value: string, requestBase: string) {
  if (/^https?:\/\//i.test(value)) return value;
  const configuredBase = process.env.VIDEO_PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  return `${configuredBase || requestBase}${value.startsWith("/") ? value : `/${value}`}`;
}

function imageMimeType(value: string) {
  const extension = value.toLowerCase().split(".").pop();
  return extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "webp" ? "image/webp" : "image/png";
}

async function referenceImageSource(value: string, requestBase: string) {
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  const configuredBase = process.env.VIDEO_PUBLIC_BASE_URL?.trim();
  if (configuredBase) return publicMediaUrl(value, requestBase);
  try {
    const filePath = resolve(subjectImageDirectory, basename(value));
    const bytes = await readFile(filePath);
    return `data:${imageMimeType(value)};base64,${bytes.toString("base64")}`;
  } catch {
    return publicMediaUrl(value, requestBase);
  }
}

async function persistGeneratedVideo(jobId: string, sourceUrl: string) {
  if (sourceUrl.startsWith("/api/generated/videos/")) return sourceUrl;
  const fileName = `${jobId}.mp4`;
  const outputPath = resolve(generatedVideoDirectory, fileName);
  const existingFile = await stat(outputPath).catch(() => null);
  if (existingFile?.isFile() && existingFile.size > 0) return `/api/generated/videos/${fileName}`;

  const temporaryPath = resolve(generatedVideoDirectory, `.${jobId}-${randomUUID()}.tmp`);
  try {
    const result = await fetch(sourceUrl, { signal: AbortSignal.timeout(300000) });
    if (!result.ok) throw new Error(`HTTP ${result.status}`);
    const bytes = Buffer.from(await result.arrayBuffer());
    if (!bytes.length) throw new Error("平台返回了空文件");
    await writeFile(temporaryPath, bytes);
    await unlink(outputPath).catch(() => undefined);
    await rename(temporaryPath, outputPath);
    const outputUrl = `/api/generated/videos/${fileName}`;
    writeLog("INFO", "[render] 视频已保存到本地", { jobId, outputUrl, bytes: bytes.length });
    return outputUrl;
  } catch (error) {
    throw new Error(`视频生成成功，但保存到本地失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function studioVideoKey(videoType: StudioVideoType, id: string) {
  return `${videoType}:${id}`;
}

async function writeStudioVideoRecord(record: StoredStudioVideo) {
  await writeFile(resolve(studioVideoDirectories[record.videoType], `${record.id}.json`), JSON.stringify(record, null, 2), "utf8");
}

async function persistStudioVideo(record: StoredStudioVideo, sourceUrl: string) {
  const directory = studioVideoDirectories[record.videoType];
  const fileName = `${record.id}.mp4`;
  const outputPath = resolve(directory, fileName);
  const temporaryPath = resolve(directory, `.${record.id}-${randomUUID()}.tmp`);
  try {
    const result = await fetch(sourceUrl, { signal: AbortSignal.timeout(300000) });
    if (!result.ok) throw new Error(`HTTP ${result.status}`);
    const bytes = Buffer.from(await result.arrayBuffer());
    if (!bytes.length) throw new Error("平台返回了空文件");
    await writeFile(temporaryPath, bytes);
    await unlink(outputPath).catch(() => undefined);
    await rename(temporaryPath, outputPath);
    return `/api/generated/${basename(directory)}/${fileName}`;
  } catch (error) {
    throw new Error(`视频生成成功，但保存到本地失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function updateStudioVideo(record: StoredStudioVideo, patch: Partial<StoredStudioVideo>) {
  const next = { ...record, ...patch, updatedAt: new Date().toISOString() };
  studioVideoTasks.set(studioVideoKey(next.videoType, next.id), next);
  await writeStudioVideoRecord(next);
  return next;
}

async function pollStudioVideo(record: StoredStudioVideo) {
  const providerTaskId = record.providerTaskId;
  if (!providerTaskId) return;
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const task = await videoGeneration.getTask(providerTaskId);
      if (task.status === "completed" && task.videoUrl) {
        const outputUrl = await persistStudioVideo(record, task.videoUrl);
        await updateStudioVideo(record, { status: "completed", progress: 100, outputUrl, errorMessage: null });
        return;
      }
      if (task.status === "failed") {
        await updateStudioVideo(record, { status: "failed", progress: task.progress, errorMessage: task.errorMessage ?? "视频平台任务失败" });
        return;
      }
      record = await updateStudioVideo(record, { status: task.status, progress: task.progress });
      await wait(5000);
    }
    await updateStudioVideo(record, { status: "failed", progress: 0, errorMessage: "视频任务轮询超时" });
  } catch (error) {
    await updateStudioVideo(record, { status: "failed", progress: 0, errorMessage: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
  }
}

async function readStudioVideoRecord(videoType: StudioVideoType, id: string) {
  const active = studioVideoTasks.get(studioVideoKey(videoType, id));
  if (active) return active;
  try {
    const value = JSON.parse(await readFile(resolve(studioVideoDirectories[videoType], `${id}.json`), "utf8")) as StoredStudioVideo;
    return value.videoType === videoType && value.id === id ? value : null;
  } catch {
    return null;
  }
}

async function listStudioVideos(videoType: StudioVideoType) {
  const directory = studioVideoDirectories[videoType];
  const names = await readdir(directory).catch(() => [] as string[]);
  const stored = (await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => readStudioVideoRecord(videoType, basename(name, ".json")))))
    .filter((item): item is StoredStudioVideo => Boolean(item));
  const merged = new Map(stored.map((item) => [item.id, item]));
  for (const item of studioVideoTasks.values()) if (item.videoType === videoType) merged.set(item.id, item);
  return [...merged.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 24);
}

async function resumeStudioVideoTasks() {
  for (const videoType of Object.keys(studioVideoDirectories) as StudioVideoType[]) {
    const records = await listStudioVideos(videoType);
    for (const record of records) {
      if ((record.status !== "queued" && record.status !== "processing") || !record.providerTaskId) continue;
      studioVideoTasks.set(studioVideoKey(videoType, record.id), record);
      void pollStudioVideo(record);
    }
  }
}

async function extractStableTailFrame(videoUrl: string, projectId: string, shotId: string) {
  const outputPath = resolve(continuityFrameDirectory, `${projectId}-${shotId}-${Date.now()}.jpg`);
  const videoSource = videoUrl.startsWith("/api/generated/videos/") ? resolve(generatedVideoDirectory, basename(videoUrl)) : videoUrl;
  const ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  try {
    await new Promise<void>((resolveFrame, rejectFrame) => {
      const child = spawn(ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-sseof", "-0.16", "-i", videoSource,
        "-frames:v", "1", "-q:v", "2", "-y", outputPath,
      ], { windowsHide: true });
      let stderr = "";
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) rejectFrame(error);
        else resolveFrame();
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error("提取上一镜头尾帧超时"));
      }, 120000);
      child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-1500); });
      child.once("error", (error) => finish(new Error(`无法启动 FFmpeg：${error.message}`)));
      child.once("close", (code) => finish(code === 0 ? undefined : new Error(`提取上一镜头尾帧失败：${stderr || `FFmpeg 退出码 ${code}`}`)));
    });
    const bytes = await readFile(outputPath);
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } finally {
    await unlink(outputPath).catch(() => undefined);
  }
}

async function continuityTailFrame(videoUrl: string, projectId: string, shotId: string) {
  const cacheKey = `${shotId}:${videoUrl}`;
  const cached = continuityFrameCache.get(cacheKey);
  if (cached) return cached;
  const frame = await extractStableTailFrame(videoUrl, projectId, shotId);
  continuityFrameCache.set(cacheKey, frame);
  if (continuityFrameCache.size > 24) {
    const oldestKey = continuityFrameCache.keys().next().value;
    if (oldestKey) continuityFrameCache.delete(oldestKey);
  }
  return frame;
}

async function pollVideoTask(jobId: string, projectId: string, taskId: string): Promise<string | null> {
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const task = await videoGeneration.getTask(taskId);
      const outputUrl = task.status === "completed" && task.videoUrl
        ? await persistGeneratedVideo(jobId, task.videoUrl)
        : null;
      await db.updateRenderJob(jobId, {
        status: task.status,
        progress: task.progress,
        outputUrl,
        errorMessage: task.errorMessage ?? null,
      });
      await broadcastRenderJobs();
      if (task.status === "completed" || task.status === "failed") {
        const jobs = (await db.listJobs()).filter((job) => job.projectId === projectId);
        const active = jobs.some((job) => job.status === "queued" || job.status === "processing");
        if (!active) await db.updateProject(projectId, { status: jobs.some((job) => job.status === "failed") ? "failed" : "completed", progress: jobs.some((job) => job.status === "failed") ? 76 : 100 });
        return task.status === "completed" ? outputUrl : null;
      }
      await wait(5000);
    }
    await db.updateRenderJob(jobId, { status: "failed", progress: 0, errorMessage: "视频任务轮询超时" });
    await broadcastRenderJobs();
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.updateRenderJob(jobId, { status: "failed", progress: 0, errorMessage: message }).catch(() => undefined);
    await broadcastRenderJobs().catch(() => undefined);
    writeLog("ERROR", "[render] 查询视频任务失败", { jobId, taskId, error: message });
    return null;
  }
}

async function resumeVideoTasks() {
  const jobs = await db.listJobs();
  for (const job of jobs) {
    if (job.status !== "queued" && job.status !== "processing") continue;
    if (!job.providerTaskId || job.provider !== "volcengine") {
      await db.updateRenderJob(job.id, { status: "failed", progress: 0, errorMessage: "历史视频任务已失效，请重新提交" });
      continue;
    }
    void pollVideoTask(job.id, job.projectId, job.providerTaskId);
  }
}

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: clientOrigin }));
app.use("/api/generated", express.static(generatedDirectory, { maxAge: "1h" }));
app.use(express.json({ limit: "22mb" }));
app.use((request, response, next) => {
  const startedAt = Date.now();
  writeLog("INFO", "[api] 请求开始", { method: request.method, path: request.originalUrl });
  response.on("finish", () => {
    writeLog(response.statusCode >= 500 ? "ERROR" : response.statusCode >= 400 ? "WARN" : "INFO", "[api] 请求完成", {
      method: request.method,
      path: request.originalUrl,
      status: response.statusCode,
      elapsedMs: Date.now() - startedAt,
    });
  });
  next();
});

const asyncRoute = (handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>) =>
  (request: Request, response: Response, next: NextFunction) => void handler(request, response, next).catch(next);

const projectSchema = z.object({
  title: z.string().trim().min(1).max(120),
  logline: z.string().trim().min(50, "一句话简介至少需要 50 个字").max(5000),
  genre: z.string().trim().min(2).max(40),
  style: z.string().trim().min(2).max(40),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  durationSeconds: z.coerce.number().int().min(15).max(720).default(60),
  targetEpisodeCount: z.coerce.number().int().min(1).max(100).default(3),
});

const patchProjectSchema = projectSchema.partial().extend({
  status: z.enum(["draft", "scripting", "storyboarding", "rendering", "completed", "failed"]).optional(),
  progress: z.number().int().min(0).max(100).optional(),
});

const scriptInputSchema = z.object({
  text: z.string().min(30).max(200000).refine((value) => value.trim().length >= 30, "剧本内容至少需要 30 个有效字符"),
});
const llmSettingsSchema = z.object({
  apiKey: z.string().max(500).optional(),
  model: z.string().trim().min(1).max(100).optional(),
  apiBase: z.string().trim().url().max(200).optional(),
});
const imageSettingsSchema = z.object({
  provider: z.enum(["volcengine", "aliyun", "openai", "custom"]).optional(),
  apiKey: z.string().max(1000).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  apiBase: z.string().trim().url().max(500).optional(),
});
const videoSettingsSchema = z.object({
  provider: z.enum(["volcengine", "aliyun", "openai", "custom"]).optional(),
  apiKey: z.string().max(1000).optional(),
  model: z.enum(["doubao-seedance-2-0-mini-260615", "doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128"]).optional(),
  apiBase: z.string().trim().url().max(500).optional(),
});
const subjectImageSchema = z.object({
  prompt: z.string().trim().min(10).max(12000),
  model: z.string().trim().min(1).max(200),
  resolution: z.enum(["2K", "4K"]),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4"]),
  referenceImage: z.string().max(11_500_000).regex(/^data:image\/[a-z0-9.+-]+;base64,/i, "参考图格式无效").optional(),
  watermark: z.boolean().optional(),
});
const studioVideoSchema = z.object({
  prompt: z.string().trim().min(10, "视频提示词至少需要 10 个字").max(16000),
  model: z.enum(["doubao-seedance-2-0-mini-260615", "doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128"]),
  ratio: z.enum(["16:9", "9:16", "1:1"]),
  duration: z.coerce.number().int().min(2).max(12),
  generateAudio: z.boolean().default(true),
  watermark: z.boolean().default(false),
  referenceImages: z.array(z.string().max(5_700_000).regex(/^data:image\/(?:png|jpeg|webp);base64,/i, "参考图格式无效")).max(3).optional(),
  firstFrame: z.string().max(5_700_000).regex(/^data:image\/(?:png|jpeg|webp);base64,/i, "首帧格式无效").optional(),
  lastFrame: z.string().max(5_700_000).regex(/^data:image\/(?:png|jpeg|webp);base64,/i, "尾帧格式无效").optional(),
});
const renderInputSchema = z.object({
  shotId: z.string().uuid().optional(),
  referenceSubjectIds: z.array(z.string().uuid()).max(12).default([]),
  model: z.enum(["doubao-seedance-2-0-mini-260615", "doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128"]).optional(),
  duration: z.coerce.number().int().min(2).max(12).optional(),
  prompt: z.string().trim().min(1).max(16000).optional(),
  audioMode: z.enum(["dialogue", "ambient", "silent"]).default("dialogue"),
  speechRate: z.enum(["slow", "natural"]).default("natural"),
  bgm: z.boolean().default(false),
  continuityMode: z.enum(["auto", "continue", "cut", "scene"]).optional(),
  continuity: z.boolean().optional(),
});
const videoMergeSchema = z.object({
  shotIds: z.array(z.string().uuid()).min(2, "至少选择两个已完成的视频镜头").max(200),
});
const shotEditSchema = z.object({
  location: z.string().trim().min(1).max(500),
  action: z.string().trim().min(1).max(5000),
  visualPrompt: z.string().trim().min(1).max(12000),
});

function dialogueWithoutNarration(dialogue: string) {
  return dialogue
    .split(/\r?\n/)
    .filter((line) => !/^\s*(旁白|解说|画外音|narrator)\s*[：:]/i.test(line))
    .join("\n")
    .replace(/\s*(旁白|解说|画外音|narrator)\s*[：:][\s\S]*$/i, "")
    .trim();
}

type ContinuityMode = "auto" | "continue" | "cut" | "scene";
type ResolvedContinuityMode = Exclude<ContinuityMode, "auto">;

function requestedContinuityMode(input: z.infer<typeof renderInputSchema>): ContinuityMode {
  return input.continuityMode ?? (input.continuity === false ? "cut" : "auto");
}

function resolveContinuityMode(mode: ContinuityMode, shot: Shot, previousShot?: Shot): ResolvedContinuityMode {
  if (mode !== "auto") return mode;
  if (!previousShot || previousShot.location.trim() !== shot.location.trim()) return "scene";
  return "continue";
}

function videoPromptForShot(shot: Shot, input: z.infer<typeof renderInputSchema>, continuityMode: ResolvedContinuityMode, previousShot?: Shot, hasFirstFrame = false, referenceSubjects: Subject[] = []) {
  const dialogue = dialogueWithoutNarration(shot.dialogue);
  const audioMode = input.audioMode === "dialogue" && !dialogue ? "ambient" : input.audioMode;
  const basePrompt = input.prompt ?? [
    `镜头：${shot.title}`,
    `场景：${shot.location}`,
    `动作：${shot.action}`,
    `摄影：${shot.camera}`,
    `画面：${shot.visualPrompt}`,
  ].join("\n");
  const previousState = previousShot ? [
    `上一镜头场景：${previousShot.location}`,
    `上一镜头结束动作：${previousShot.action}`,
    `上一镜头画面提示词（以它描述的最终画面为本镜头起点）：${previousShot.visualPrompt}`,
  ] : [];
  const continuityPrompt = continuityMode === "continue" ? [
    "衔接方式：动作续接。剪辑点位于视频开始之前，本视频只呈现当前镜头，不制作片内转场。",
    hasFirstFrame ? "输入首帧来自上一镜头的稳定尾帧，是本次生成的最高优先级视觉约束。视频第 0 秒必须与输入首帧一致，禁止重新绘制开场、替换构图或跳到另一幅画面；必须从该姿势、人物位置、视线、道具位置和运动方向开始继续动作。" : "从上一镜头结束状态继续动作，不重复已经完成的动作。",
    ...previousState,
    "当前镜头不是一段独立重启的画面，必须以上一镜头提示词和尾帧的结束状态为起点，在连续时间中逐步发展到当前镜头描述的动作与构图。",
    "保持当前摄影机的景别、机位和构图稳定；严禁从上一构图旋转、推拉、环绕或变形成当前构图，严禁淡入淡出、叠化、甩镜或无理由转景。",
    "色彩锁定：输入首帧的实际像素是本视频唯一的色彩基准。后文即使出现“暖色调”“冷色调”或其他与首帧不一致、含糊的调色描述，也只能理解为保持首帧现状，不能据此重新调色。",
    "从第 0 秒到结束逐帧锁定首帧的色温、白平衡、曝光、对比度、黑白场、饱和度和光源方向；严禁逐渐变暖或变冷，严禁叠加黄色、橙色、绿色滤镜，严禁发生泛黄、褪色、色偏或亮度漂移。只允许物体运动造成局部自然明暗变化。",
    "保持同一人物的面容、发型、服装、体态和所持道具一致，保持空间方位和运动方向连续。",
  ].join("\n") : continuityMode === "cut" ? [
    "衔接方式：直接切镜。剪辑切换已经发生在视频开始之前，第一帧必须直接呈现当前镜头指定的景别、机位和构图。",
    ...previousState,
    "只继承人物外观、服装、道具、光线、视线、空间方位和动作进度；不要展示从上一机位移动到当前机位的过程。",
    "严禁片内转场、镜头绕行、构图变形、淡入淡出、叠化或甩镜。",
  ].join("\n") : [
    "衔接方式：场景切换。场景切换已经发生在视频开始之前，第一帧直接进入当前场景和目标构图。",
    ...previousState,
    "即使更换了地点，也要继承上一镜头已经建立的可见人物外观、服装、道具、动作进度、视线方向、叙事因果、基础色温和统一调色；只在剪辑点切换空间，不要把当前镜头写成与前镜头无关的全新故事。",
    "除非当前镜头内容明确要求，否则严禁在片内制作转场、淡入淡出、叠化、甩镜、穿越遮挡或从上一场景变形成当前场景。",
  ].join("\n");
  const audioPrompt = audioMode === "silent"
    ? "声音要求：生成无声视频，不要对白、内心 OS、旁白、解说、环境音或音乐。"
    : audioMode === "ambient"
      ? "声音要求：只生成与画面同步的环境音和动作拟音，禁止任何人声、旁白、解说或内心 OS。"
      : [
        `允许说出的唯一文本（人物对白 / 内心 OS，必须逐字使用）：${dialogue}`,
        "禁止把场景、动作、背景介绍或提示词朗读出来；禁止自行补写旁白、解说、台词或口头语。对白由对应人物说出，标注为 OS 的内容只作为该人物内心声音。",
        input.speechRate === "slow" ? "说话语速：舒缓，句间保留自然停顿，不能通过添加内容填满时长。" : "说话语速：自然，吐字清楚，不抢拍。",
      ].join("\n");
  const musicPrompt = audioMode === "silent" || !input.bgm
    ? "音乐要求：不要背景音乐。"
    : "音乐要求：使用克制的背景音乐，不得盖过对白和关键环境音。";
  const subjectPrompt = referenceSubjects.length ? [
    hasFirstFrame
      ? "主体一致性补充：平台不允许首帧与主体参考图同时作为媒体输入，以下主体资料仅用于补足首帧中不清晰或尚未出现的细节，不能覆盖首帧的光线、色彩、构图和已有主体外观。"
      : "主体参考要求：严格保持已选参考主体的身份、外形、材质和关键特征一致。",
    ...referenceSubjects.map((subject) => {
      const roleName = subject.role === "character" ? "角色" : subject.role === "location" ? "场景" : "道具";
      const roleGuard = subject.role === "location"
        ? "场景参考只约束空间结构、固定设施、材质和布局，禁止把场景主体图中可能出现的人物或动作带入当前镜头；保持门窗、出入口、家具、动线和相对位置合理固定。"
        : subject.role === "prop"
          ? "道具参考只约束该物品完整外形、材质、比例和结构，不得复制主体图的背景、桌面、手或使用者。"
          : "角色参考只约束当前阶段人物的身份、面容、发型、服装和体态。";
      return `${roleName}「${subject.name}」：${subject.description || "未设定"}；视觉特征：${subject.visualPrompt || "未设定"}；${roleGuard}`;
    }),
  ].join("\n") : "";
  const contentPrompt = input.prompt
    ? `用户确认的视频提示词（除连续性首帧约束外必须执行）：\n${basePrompt}`
    : `${basePrompt}`;
  return [contentPrompt, continuityPrompt, subjectPrompt, audioPrompt, musicPrompt, "画面中不要生成字幕、标题、标牌式说明文字或水印。"].filter(Boolean).join("\n\n");
}

async function latestCompletedVideo(projectId: string, shotId: string) {
  const job = (await db.listJobs()).find((candidate) => candidate.projectId === projectId && candidate.shotId === shotId && candidate.status === "completed" && candidate.outputUrl);
  return job?.outputUrl ?? null;
}

interface StoredVideoMerge {
  id: string;
  projectId: string;
  outputUrl: string;
  shotIds: string[];
  durationSeconds: number;
  createdAt: string;
  coverUrl?: string | null;
}

async function listVideoMerges(projectId: string): Promise<StoredVideoMerge[]> {
  const names = await readdir(videoMergeDirectory).catch(() => [] as string[]);
  const records = await Promise.all(names
    .filter((name) => name.startsWith(`${projectId}-`) && name.endsWith(".json"))
    .map(async (name) => {
      try {
        const value = JSON.parse(await readFile(resolve(videoMergeDirectory, name), "utf8")) as StoredVideoMerge;
        return value.projectId === projectId && value.outputUrl ? value : null;
      } catch {
        return null;
      }
    }));
  return records.filter((item): item is StoredVideoMerge => Boolean(item)).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function downloadMergeInput(source: string, outputPath: string, requestBase: string) {
  const sourceUrl = /^https?:\/\//i.test(source) ? source : `${requestBase}${source.startsWith("/") ? source : `/${source}`}`;
  const result = await fetch(sourceUrl, { signal: AbortSignal.timeout(180000) });
  if (!result.ok) throw new Error(`读取镜头视频失败（HTTP ${result.status}）`);
  await writeFile(outputPath, Buffer.from(await result.arrayBuffer()));
}

async function runVideoMerge(inputPaths: string[], outputPath: string, listPath: string) {
  const ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const entries = inputPaths.map((inputPath) => `file '${inputPath.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n");
  await writeFile(listPath, `${entries}\n`, "utf8");
  const execute = (transcode: boolean) => new Promise<void>((resolveMerge, rejectMerge) => {
    const args = ["-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath,
      ...(transcode ? ["-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac", "-b:a", "192k"] : ["-c", "copy"]),
      "-movflags", "+faststart", "-y", outputPath];
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectMerge(error);
      else resolveMerge();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("视频合并超时"));
    }, 15 * 60 * 1000);
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-4000); });
    child.once("error", (error) => finish(new Error(`无法启动 FFmpeg：${error.message}`)));
    child.once("close", (code) => finish(code === 0 ? undefined : new Error(stderr || `FFmpeg 退出码 ${code}`)));
  });
  try {
    await execute(false);
  } catch (copyError) {
    await unlink(outputPath).catch(() => undefined);
    writeLog("WARN", "[video-merge] 无损拼接失败，改用统一编码", { error: copyError instanceof Error ? copyError.message : String(copyError) });
    await execute(true);
  }
}

async function createProjectCoverFromMerge(projectId: string, mergeId: string, videoPath: string) {
  const coverName = `${projectId}-${mergeId}.jpg`;
  const coverPath = resolve(projectCoverDirectory, coverName);
  const ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  await new Promise<void>((resolveCover, rejectCover) => {
    const child = spawn(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-i", videoPath,
      "-vf", "select=eq(n\\,0)", "-frames:v", "1", "-q:v", "2", "-y", coverPath,
    ], { windowsHide: true });
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectCover(error);
      else resolveCover();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("提取项目封面超时"));
    }, 120000);
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-1500); });
    child.once("error", (error) => finish(new Error(`无法启动 FFmpeg：${error.message}`)));
    child.once("close", (code) => finish(code === 0 ? undefined : new Error(`提取项目封面失败：${stderr || `FFmpeg 退出码 ${code}`}`)));
  });
  return `/api/generated/covers/${coverName}`;
}

async function processRenderSequence(input: {
  project: Project;
  shots: Shot[];
  allShots: Shot[];
  jobs: RenderJob[];
  subjects: Subject[];
  renderInput: z.infer<typeof renderInputSchema>;
  requestBase: string;
}) {
  const { project, shots, allShots, jobs, subjects, renderInput, requestBase } = input;
  const generatedVideos = new Map<string, string>();
  const requestedMode = requestedContinuityMode(renderInput);

  for (const [index, shot] of shots.entries()) {
    const job = jobs[index];
    const previousShot = allShots
      .filter((candidate) => candidate.episodeNumber === shot.episodeNumber && candidate.shotOrder < shot.shotOrder)
      .sort((left, right) => right.shotOrder - left.shotOrder)[0];
    let continuityMode = resolveContinuityMode(requestedMode, shot, previousShot);
    let firstFrameUrl: string | undefined;

    try {
      if (continuityMode === "continue") {
        if (!previousShot) throw new Error("动作续接需要同一集中的上一镜头");
        const previousVideo = generatedVideos.get(previousShot.id) ?? await latestCompletedVideo(project.id, previousShot.id);
        if (!previousVideo) {
          if (requestedMode === "continue") throw new Error("上一镜头还没有可用的成片，请先完成上一镜头视频");
          continuityMode = "cut";
          writeLog("WARN", "[render] 自动衔接缺少上一镜头视频，已改为直接切镜", { projectId: project.id, shotId: shot.id, previousShotId: previousShot.id });
        } else {
          try {
            firstFrameUrl = await continuityTailFrame(previousVideo, project.id, previousShot.id);
          } catch (error) {
            if (requestedMode === "continue") throw error;
            continuityMode = "cut";
            writeLog("WARN", "[render] 自动衔接无法提取尾帧，已改为直接切镜", { projectId: project.id, shotId: shot.id, error: error instanceof Error ? error.message : String(error) });
          }
        }
      }

      const content = [shot.title, shot.location, shot.action, shot.dialogue, shot.visualPrompt].join(" ");
      const referenceSubjects = (renderInput.referenceSubjectIds.length
        ? subjects.filter((subject) => renderInput.referenceSubjectIds.includes(subject.id))
        : subjects.filter((subject) => subject.imageUrl && subject.name.trim() && content.includes(subject.name.trim())))
        .filter((subject) => subject.imageUrl)
        .slice(0, firstFrameUrl ? 11 : 12);
      const generationPrompt = videoPromptForShot(shot, { ...renderInput, prompt: shots.length === 1 ? renderInput.prompt : undefined }, continuityMode, previousShot, Boolean(firstFrameUrl), referenceSubjects);
      await db.setRenderJobPrompt(job.id, generationPrompt);
      const task = await videoGeneration.createTask({
        prompt: generationPrompt,
        model: renderInput.model,
        referenceImageUrls: await Promise.all(referenceSubjects.map((subject) => referenceImageSource(subject.imageUrl!, requestBase))),
        firstFrameUrl,
        ratio: project.aspectRatio,
        duration: renderInput.duration ?? shot.durationSeconds,
        generateAudio: renderInput.audioMode !== "silent",
      });
      await db.startRenderJob(job.id, task.taskId, task.status, task.progress);
      await broadcastRenderJobs();
      writeLog("INFO", "[render] 已提交串行视频任务", {
        projectId: project.id,
        shotId: shot.id,
        taskId: task.taskId,
        continuityMode,
        continuityFrameApplied: Boolean(firstFrameUrl) && !task.continuityFrameFallback,
        referenceFallback: task.referenceFallback,
        referenceSubjectIds: referenceSubjects.map((subject) => subject.id),
      });

      let outputUrl = task.status === "completed" && task.videoUrl
        ? await persistGeneratedVideo(job.id, task.videoUrl)
        : task.status === "completed"
          ? null
          : await pollVideoTask(job.id, project.id, task.taskId);
      if (task.status === "completed" && outputUrl) {
        await db.updateRenderJob(job.id, { status: "completed", progress: 100, outputUrl });
        await broadcastRenderJobs();
      }
      if (!outputUrl) throw new Error("当前镜头生成失败，后续镜头已停止，以免失去连续性");
      generatedVideos.set(shot.id, outputUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.updateRenderJob(job.id, { status: "failed", progress: 0, errorMessage: message });
      for (const pending of jobs.slice(index + 1)) {
        await db.updateRenderJob(pending.id, { status: "failed", progress: 0, errorMessage: "前序镜头未完成，连续生成已停止" });
      }
      await db.updateProject(project.id, { status: "failed", progress: 76 });
      await broadcastRenderJobs();
      writeLog("ERROR", "[render] 串行视频生成停止", { projectId: project.id, shotId: shot.id, error: message });
      return;
    }
  }

  await db.updateProject(project.id, { status: "completed", progress: 100 });
  await broadcastRenderJobs();
}

function normalizeScript(text: string) {
  const lines = text.split(/\r\n|\r|\n/);
  const titleIndex = lines.findIndex((line) => line.trim().length > 0);
  const title = titleIndex >= 0 ? lines[titleIndex] : "未命名剧本";
  const output: string[] = ["【剧本标题】", title, "", "【专业格式】", "场次 / 时间地点 / 人物 / 动作 / 对白 / 原文备注", ""];
  let scene = 0;
  for (const [index, line] of lines.entries()) {
    if (index === titleIndex) continue;
    const content = line.trim();
    if (!content) {
      output.push("");
      continue;
    }
    if (/^(场|第\s*\d+\s*[集场]|INT\.?|EXT\.?|内|外)/i.test(content)) {
      scene += 1;
      output.push(`【场次 ${String(scene).padStart(2, "0")}】 ${line}`);
    } else if (/^(类型|题材|作者|时长|简介)\s*[:：]/.test(content)) {
      output.push(`元信息：${line}`);
    } else if (/^[“”"「」]/.test(content) || /^[^:：]{1,30}[:：]/.test(content)) {
      output.push(`对白：${line}`);
    } else {
      output.push(`动作：${line}`);
    }
  }
  return output.join("\n");
}

function splitFormattedScript(sourceText: string, targetEpisodeCount: number) {
  const lines = sourceText.split(/\r\n|\r|\n/);
  const sceneStarts = lines
    .map((line, index) => (/^\s*【场次\s+\d+】/u.test(line) ? index : -1))
    .filter((index) => index >= 0);
  const chunks = Array.from({ length: targetEpisodeCount }, () => [] as string[]);

  if (sceneStarts.length > 0) {
    for (let index = 0; index < lines.length; index += 1) {
      const sceneIndex = sceneStarts.reduce((last, start, sceneNumber) => start <= index ? sceneNumber : last, -1);
      const target = Math.min(targetEpisodeCount - 1, Math.floor(Math.max(0, sceneIndex) * targetEpisodeCount / sceneStarts.length));
      chunks[target].push(lines[index]);
    }
  } else {
    const chunkSize = Math.max(1, Math.ceil(lines.length / targetEpisodeCount));
    for (let index = 0; index < targetEpisodeCount; index += 1) chunks[index] = lines.slice(index * chunkSize, (index + 1) * chunkSize);
  }

  return chunks.map((chunk) => chunk.join("\n").trim());
}

function episodesFromText(projectId: string, sourceText: string, targetEpisodeCount = 3) {
  const character = { name: "未设定", introduction: "未设定", costume: "未设定", personality: "未设定", expressions: "未设定", continuityNotes: "未设定" };
  const formattedChunks = splitFormattedScript(sourceText, targetEpisodeCount);
  const templates = [
    { episodeNumber: 1, title: "第一集 · 雨停之前", summary: "主角在午夜车站收到一条来自未来的讯息，故事由此启动。", hook: "一封来自未来的信进入空车站。", plotNodes: ["建立午夜车站与主角状态", "收到来自未来的信", "结尾留下列车声音悬念"], characters: [character], status: "ready" as const },
    { episodeNumber: 2, title: "第二集 · 不上车的人", summary: "车站的旧档案揭开了检票员不曾离开的原因。", hook: "旧档案暴露出一个不该存在的记录。", plotNodes: ["调查旧档案", "发现人物关系线索", "结尾悬念升级"], characters: [character], status: "ready" as const },
    { episodeNumber: 3, title: "第三集 · 最后一班车", summary: "列车抵达，主角必须在告别与重逢之间做出选择。", hook: "最后一班车在无人等待的站台抵达。", plotNodes: ["列车抵达", "主角面临选择", "完成本地演示结尾"], characters: [character], status: "ready" as const },
  ];
  return Array.from({ length: targetEpisodeCount }, (_, index) => {
    const template = templates[index % templates.length];
    return { ...template, episodeNumber: index + 1, title: index < templates.length ? template.title : `第${index + 1}集 · 故事继续`, originalText: formattedChunks[index] ?? "" };
  });
}

function subjectsFromProject(project: { title: string; style: string }) {
  return [
    { name: "林默", role: "character" as const, description: "29 岁，夜班检票员，沉默克制，始终守在废弃月台。", visualPrompt: `${project.style}，林默，短黑发，深色旧制服，疲惫而专注的眼神，人物设定图` },
    { name: "午夜车站", role: "location" as const, description: "城市边缘的旧车站，雨后潮湿，只有一盏信号灯仍在工作。无人空场景；明确站房、检票亭、月台、轨道、站牌、出入口和固定灯具的相对位置，布局符合真实车站动线。", visualPrompt: `${project.style}，午夜旧车站完整空场景设定图，雨后月台、站房、检票亭、站牌、轨道和孤独信号灯，合理建筑布局，无人物无动物无手无人体，无剧情动作，无漂浮或穿模` },
    { name: "未来来信", role: "prop" as const, description: "一封没有寄件人的纸质信，落款日期是二十年以后。完整单体纸信，包含纸张、折痕、边缘、信封封口和可辨识的日期细节，不带人物、手、桌面或其他背景。", visualPrompt: `${project.style}，未来来信完整单体道具设定图，泛黄纸张、信封、折痕、封口、未来日期细节，展示完整外形和材质，无人物无手无桌面无场景` },
  ];
}

function shotsFromEpisodes(projectId: string, episodes: Array<{ id: string; episodeNumber: number }>, style: string) {
  const templates = [
    ["月台建立", "午夜车站 / 月台", "雨水沿着站牌滴落，林默独自检查最后一盏灯。", "", "广角，雨后旧车站，孤独人物，电影级低照度，空气透视", "横移"],
    ["信件出现", "检票亭 / 内", "一封没有寄件人的信从售票窗口缓缓滑入。", "林默：这不可能。", "手部特写，泛黄信件，红色未来日期，悬疑氛围", "推近"],
    ["列车入站", "远端月台 / 外", "远处没有轨道的方向亮起车灯，铁轨开始震动。", "广播：请最后一位乘客上车。", "超现实列车冲入黑夜，雾气，冷蓝与暖橙对撞，史诗构图", "快速拉远"],
  ];
  return episodes.flatMap((episode) => templates.map((template, index) => {
    const continuity = index === 0
      ? "连续性锚点：本集首镜头建立人物、道具、空间方位、光线、色温和运动方向基线，并写清结束状态。"
      : "连续性锚点：本镜头第 0 秒从上一镜头结束状态自然开始，继承人物/道具位置、姿势、视线、空间方位、光线、色温、曝光、饱和度和运动方向；先保持状态再逐步完成当前动作，禁止重新入场或片内转场。";
    return { episodeId: episode.id, episodeNumber: episode.episodeNumber, shotOrder: index + 1, title: `${String(index + 1).padStart(2, "0")} · ${template[0]}`, location: template[1], action: template[2], dialogue: template[3], visualPrompt: `${continuity}\n当前画面：${style}，${template[4]}`, camera: template[5], durationSeconds: index === 2 ? 8 : 6, status: "ready" as const };
  }));
}

function scriptFromProject(project: { title: string; logline: string; genre: string; style: string; durationSeconds: number; targetEpisodeCount: number }) {
  return `${project.title}
类型：${project.genre}
视觉基调：${project.style}
目标时长：${project.durationSeconds} 秒
目标集数：${project.targetEpisodeCount} 集

人物
主角：围绕“${project.logline}”展开行动的核心人物。

场次一：外景，故事发生地，夜
一个足以改变主角选择的异常细节出现在视线里。主角停下脚步，确认自己没有看错。

主角：这不可能。

场次二：内景，临时安全处，深夜
主角把线索摊在桌面上，逐一回忆刚才发生的事情。门外传来不属于这个时间的脚步声，冲突被迫升级。

主角：如果这是真的，我就必须在天亮前找到答案。

场次三：外景，关键地点，黎明前
主角面对真相，也必须为自己的选择承担后果。远处天色开始变亮，故事在一个明确但仍有余韵的决定中结束。`;
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "script-master-api", database: databaseUrl.startsWith("mysql://") ? "mysql" : "sqlite", model: deepSeekConfig.model, modelEnabled: deepSeekConfig.enabled, localFallback, time: new Date().toISOString() });
});

app.get("/api/settings/llm", (_request, response) => {
  response.json({ data: getDeepSeekSettings() });
});

app.put("/api/settings/llm", asyncRoute(async (request, response) => {
  const input = llmSettingsSchema.parse(request.body);
  response.json({ data: configureDeepSeek(input) });
}));

app.get("/api/settings/image", (_request, response) => {
  response.json({ data: getImageSettings() });
});

app.put("/api/settings/image", asyncRoute(async (request, response) => {
  const input = imageSettingsSchema.parse(request.body);
  response.json({ data: configureImage(input) });
}));

app.get("/api/settings/video", (_request, response) => {
  response.json({ data: getVideoSettings() });
});

app.put("/api/settings/video", asyncRoute(async (request, response) => {
  const input = videoSettingsSchema.parse(request.body);
  response.json({ data: configureVideo(input) });
}));

app.get("/api/tools/:assetType-images", asyncRoute(async (request, response) => {
  const assetType = String(request.params.assetType) as keyof typeof studioImageDirectories;
  const directory = studioImageDirectories[assetType];
  if (!directory) return response.status(404).json({ error: "不支持的资产类型" });
  const names = await readdir(directory).catch(() => [] as string[]);
  const images = (await Promise.all(names
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .map(async (name) => {
      const file = await stat(resolve(directory, name)).catch(() => null);
      if (!file?.isFile()) return null;
      return { id: name, imageUrl: `/api/generated/${basename(directory)}/${name}`, model: "", size: "", prompt: "", createdAt: file.mtime.toISOString() };
    })))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 24);
  response.json({ data: images });
}));

app.post("/api/tools/:assetType-images", asyncRoute(async (request, response) => {
  const startedAt = Date.now();
  const assetType = String(request.params.assetType) as keyof typeof studioImageDirectories;
  const directory = studioImageDirectories[assetType];
  if (!directory) return response.status(404).json({ error: "不支持的资产类型" });
  if (!imageGeneration.enabled) return response.status(503).json({ error: "尚未配置图片生成 API Key，请先打开模型设置" });
  const input = subjectImageSchema.parse(request.body);
  const generated = await imageGeneration.generate(input);
  if (!generated.bytes.length) throw new Error("图片平台返回了空文件");
  if (generated.bytes.length > 25 * 1024 * 1024) throw new Error("生成图片超过 25MB，无法保存到本地");
  const extension = generated.mimeType === "image/jpeg" ? "jpg" : generated.mimeType === "image/webp" ? "webp" : "png";
  const fileName = `${randomUUID()}.${extension}`;
  await writeFile(resolve(directory, fileName), generated.bytes);
  const result = { id: fileName, imageUrl: `/api/generated/${basename(directory)}/${fileName}`, model: input.model, size: generated.size, prompt: input.prompt, createdAt: new Date().toISOString() };
  writeLog("INFO", "[generate-studio-asset] 完成", { assetType, imageUrl: result.imageUrl, model: input.model, size: generated.size, elapsedMs: Date.now() - startedAt });
  response.json({ data: result });
}));

app.get("/api/tools/:videoType-videos", asyncRoute(async (request, response) => {
  const videoType = String(request.params.videoType) as StudioVideoType;
  if (!studioVideoDirectories[videoType]) return response.status(404).json({ error: "不支持的视频工具" });
  response.json({ data: await listStudioVideos(videoType) });
}));

app.get("/api/tools/:videoType-videos/:id", asyncRoute(async (request, response) => {
  const videoType = String(request.params.videoType) as StudioVideoType;
  if (!studioVideoDirectories[videoType]) return response.status(404).json({ error: "不支持的视频工具" });
  const item = await readStudioVideoRecord(videoType, String(request.params.id));
  if (!item) return response.status(404).json({ error: "视频任务不存在" });
  response.json({ data: item });
}));

app.post("/api/tools/:videoType-videos", asyncRoute(async (request, response) => {
  const videoType = String(request.params.videoType) as StudioVideoType;
  if (!studioVideoDirectories[videoType]) return response.status(404).json({ error: "不支持的视频工具" });
  if (!videoGeneration.enabled) return response.status(503).json({ error: "尚未配置视频生成 API Key，请先打开模型设置" });
  const input = studioVideoSchema.parse(request.body ?? {});
  if (videoType === "reference-video" && !input.referenceImages?.length) return response.status(400).json({ error: "请至少添加一张参考图" });
  if (videoType === "keyframe-video" && !input.firstFrame) return response.status(400).json({ error: "请添加首帧图片" });

  const task = await videoGeneration.createTask({
    prompt: input.prompt,
    model: input.model,
    referenceImageUrls: videoType === "reference-video" ? input.referenceImages : undefined,
    firstFrameUrl: videoType === "keyframe-video" ? input.firstFrame : undefined,
    lastFrameUrl: videoType === "keyframe-video" ? input.lastFrame : undefined,
    ratio: input.ratio,
    duration: input.duration,
    generateAudio: input.generateAudio,
    watermark: input.watermark,
  });
  const now = new Date().toISOString();
  let record: StoredStudioVideo = {
    id: randomUUID(), videoType, status: task.status, progress: task.progress, outputUrl: null, errorMessage: null,
    prompt: input.prompt, model: input.model, ratio: input.ratio, duration: input.duration, createdAt: now, updatedAt: now, providerTaskId: task.taskId,
  };
  studioVideoTasks.set(studioVideoKey(videoType, record.id), record);
  await writeStudioVideoRecord(record);
  if (task.status === "completed" && task.videoUrl) {
    const outputUrl = await persistStudioVideo(record, task.videoUrl);
    record = await updateStudioVideo(record, { status: "completed", progress: 100, outputUrl });
  } else {
    void pollStudioVideo(record);
  }
  writeLog("INFO", "[studio-video] 已提交", { videoType, id: record.id, providerTaskId: task.taskId });
  response.status(202).json({ data: record });
}));

app.get("/api/dashboard", asyncRoute(async (_request, response) => {
  const [projects, jobs, localVideos] = await Promise.all([db.listProjects(), db.listJobs(), localVideoStorageStats()]);
  const completed = projects.filter((project) => project.status === "completed").length;
  response.json({
    stats: {
      projectCount: projects.length,
      completedCount: completed,
      activeRenders: jobs.filter((job) => ["queued", "processing"].includes(job.status)).length,
      generatedSeconds: projects.reduce((sum, project) => sum + (project.status === "completed" ? project.durationSeconds : 0), 0),
      localVideoCount: localVideos.videoCount,
      localVideoBytes: localVideos.bytes,
    },
    projects: projects.slice(0, 6),
    jobs: jobs.slice(0, 4),
  });
}));

app.get("/api/projects", asyncRoute(async (_request, response) => {
  response.json({ data: await db.listProjects() });
}));

app.post("/api/projects", asyncRoute(async (request, response) => {
  const startedAt = Date.now();
  try {
    const input = projectSchema.parse(request.body);
    writeLog("INFO", "[create-project] 开始", { title: input.title, genre: input.genre, durationSeconds: input.durationSeconds, loglineLength: input.logline.length });
    const project = await db.createProject(input);
    writeLog("INFO", "[create-project] 完成", { projectId: project.id, elapsedMs: Date.now() - startedAt });
    response.status(201).json({ data: project });
  } catch (error) {
    writeLog("ERROR", "[create-project] 失败", { elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.stack ?? error.message : String(error) });
    throw error;
  }
}));

app.delete("/api/projects/:id", asyncRoute(async (request, response) => {
  const projectId = String(request.params.id);
  const deleted = await db.deleteProject(projectId);
  if (!deleted) return response.status(404).json({ error: "项目不存在" });
  writeLog("INFO", "[delete-project] 完成", { projectId });
  response.status(204).send();
}));

app.get("/api/projects/:id", asyncRoute(async (request, response) => {
  const project = await db.getProject(String(request.params.id));
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const scenes = await db.listScenes(project.id);
  response.json({ data: { ...project, scenes } });
}));

app.patch("/api/projects/:id", asyncRoute(async (request, response) => {
  const input = patchProjectSchema.parse(request.body);
  const project = await db.updateProject(String(request.params.id), input);
  if (!project) return response.status(404).json({ error: "项目不存在" });
  response.json({ data: project });
}));

app.get("/api/projects/:id/pipeline", asyncRoute(async (request, response) => {
  const project = await db.getProject(String(request.params.id));
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const [document, episodes, subjects, shots] = await Promise.all([db.getScriptDocument(project.id), db.listEpisodes(project.id), db.listSubjects(project.id), db.listShots(project.id)]);
  response.json({ data: { project, document, episodes, subjects, shots } });
}));

app.post("/api/projects/:id/format", asyncRoute(async (request, response) => {
  const project = await db.getProject(String(request.params.id));
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const { text } = scriptInputSchema.parse(request.body);
  if (!deepSeek.enabled && !localFallback) return response.status(503).json({ error: "尚未配置 DeepSeek API Key，请先打开模型设置" });
  let formattedText = normalizeScript(text);
  let qualityReport = "本地保真格式化：原文逐字保留";
  if (deepSeek.enabled) {
    try {
      const result = await deepSeek.formatScript(text);
      formattedText = result.formattedText;
      qualityReport = result.qualityReport;
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      if (!detail.includes("原文保真校验")) throw caught;
      // Preserve the user's text and keep the pipeline usable when the model's audit field drifts.
      formattedText = normalizeScript(text);
      qualityReport = "模型保真校验未通过，已使用本地原文保真格式化";
      writeLog("WARN", "[format] 模型保真校验失败，降级本地格式化", { projectId: project.id, detail });
    }
  }
  const document = await db.saveScriptDocument(project.id, text, formattedText);
  const updated = await db.updateProject(project.id, { status: "scripting", progress: 20 });
  response.json({ data: { project: updated, document, qualityReport, engine: deepSeek.enabled ? deepSeekConfig.model : "local-fallback" } });
}));

app.post("/api/projects/:id/episodes/extract", asyncRoute(async (request, response) => {
  const startedAt = Date.now();
  const project = await db.getProject(String(request.params.id));
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const document = await db.getScriptDocument(project.id);
  if (!document?.formattedText) return response.status(409).json({ error: "请先完成剧本格式化" });
  if (!deepSeek.enabled && !localFallback) return response.status(503).json({ error: "尚未配置 DeepSeek API Key，无法调用分集模型" });
  writeLog("INFO", "[extract-episodes] 开始", {
    projectId: project.id,
    formattedLength: document.formattedText.length,
    targetDurationSeconds: project.durationSeconds,
    targetEpisodeCount: project.targetEpisodeCount,
    outputTokenBudget: SCRIPT_GENERATION_OUTPUT_TOKEN_BUDGET,
    engine: deepSeek.enabled ? deepSeekConfig.model : "local-fallback",
  });
  const episodes = await db.replaceEpisodes(project.id, deepSeek.enabled ? await deepSeek.extractEpisodes(document.formattedText, project.durationSeconds, project.targetEpisodeCount) : episodesFromText(project.id, document.formattedText, project.targetEpisodeCount));
  const updated = await db.updateProject(project.id, { status: "storyboarding", progress: 38 });
  writeLog("INFO", "[extract-episodes] 完成", { projectId: project.id, episodeCount: episodes.length, elapsedMs: Date.now() - startedAt });
  response.json({ data: { project: updated, episodes, engine: deepSeek.enabled ? deepSeekConfig.model : "local-fallback" } });
}));

app.post("/api/projects/:id/subjects/extract", asyncRoute(async (request, response) => {
  const project = await db.getProject(String(request.params.id));
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const episodes = await db.listEpisodes(project.id);
  if (!episodes.length) return response.status(409).json({ error: "请先完成分集" });
  if (!deepSeek.enabled && !localFallback) return response.status(503).json({ error: "尚未配置 DeepSeek API Key，无法调用主体模型" });
  const subjects = await db.replaceSubjects(project.id, deepSeek.enabled ? await deepSeek.extractSubjects((await db.getScriptDocument(project.id))?.formattedText ?? "", project.style) : subjectsFromProject(project));
  const updated = await db.updateProject(project.id, { status: "storyboarding", progress: 56 });
  response.json({ data: { project: updated, subjects, engine: deepSeek.enabled ? deepSeekConfig.model : "local-fallback" } });
}));

app.delete("/api/projects/:id/subjects/:subjectId", asyncRoute(async (request, response) => {
  const project = await db.getProject(String(request.params.id));
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const subject = (await db.listSubjects(project.id)).find((item) => item.id === String(request.params.subjectId));
  if (!subject) return response.status(404).json({ error: "主体不存在" });
  const deleted = await db.deleteSubject(project.id, subject.id);
  if (!deleted) return response.status(404).json({ error: "主体不存在" });
  if (subject.imageUrl) await unlink(resolve(subjectImageDirectory, basename(subject.imageUrl))).catch(() => undefined);
  response.json({ data: { project, subjects: await db.listSubjects(project.id) } });
}));

app.post("/api/projects/:id/subjects/:subjectId/image", asyncRoute(async (request, response) => {
  const startedAt = Date.now();
  const projectId = String(request.params.id);
  const subjectId = String(request.params.subjectId);
  const project = await db.getProject(projectId);
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const subject = (await db.listSubjects(projectId)).find((item) => item.id === subjectId);
  if (!subject) return response.status(404).json({ error: "主体不存在" });
  if (!imageGeneration.enabled) return response.status(503).json({ error: "尚未配置图片生成 API Key，请先打开模型设置" });
  const input = subjectImageSchema.parse(request.body);

  writeLog("INFO", "[generate-subject-image] 开始", {
    projectId,
    subjectId,
    subjectName: subject.name,
    provider: imageConfig.provider,
    model: input.model,
    resolution: input.resolution,
    aspectRatio: input.aspectRatio,
    hasReferenceImage: Boolean(input.referenceImage),
  });
  const generated = await imageGeneration.generate(input);
  if (!generated.bytes.length) throw new Error("图片平台返回了空文件");
  if (generated.bytes.length > 25 * 1024 * 1024) throw new Error("生成图片超过 25MB，无法保存到本地");
  const extension = generated.mimeType === "image/jpeg" ? "jpg" : generated.mimeType === "image/webp" ? "webp" : "png";
  const fileName = `${randomUUID()}.${extension}`;
  await writeFile(resolve(subjectImageDirectory, fileName), generated.bytes);
  const updated = await db.updateSubjectImage(projectId, subjectId, `/api/generated/subjects/${fileName}`);
  if (!updated) return response.status(404).json({ error: "主体不存在" });
  writeLog("INFO", "[generate-subject-image] 完成", { projectId, subjectId, imageUrl: updated.imageUrl, model: input.model, size: generated.size, elapsedMs: Date.now() - startedAt });
  response.json({ data: { subject: updated, provider: imageConfig.provider, model: input.model, size: generated.size } });
}));

app.post("/api/projects/:id/shots/extract", asyncRoute(async (request, response) => {
  const startedAt = Date.now();
  const project = await db.getProject(String(request.params.id));
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const episodes = await db.listEpisodes(project.id);
  if (!episodes.length) return response.status(409).json({ error: "请先完成分集" });
  const subjects = await db.listSubjects(project.id);
  if (!deepSeek.enabled && !localFallback) return response.status(503).json({ error: "尚未配置 DeepSeek API Key，无法调用分镜模型" });
  const document = await db.getScriptDocument(project.id);
  writeLog("INFO", "[extract-shots] 开始", {
    projectId: project.id,
    formattedLength: document?.formattedText.length ?? 0,
    episodeCount: episodes.length,
    subjectCount: subjects.length,
    outputTokenBudget: SCRIPT_GENERATION_OUTPUT_TOKEN_BUDGET,
    engine: deepSeek.enabled ? deepSeekConfig.model : "local-fallback",
  });
  const shots = await db.replaceShots(project.id, deepSeek.enabled ? await deepSeek.extractShots(document?.formattedText ?? "", episodes, subjects, project.style) : shotsFromEpisodes(project.id, episodes, project.style));
  const updated = await db.updateProject(project.id, { status: "storyboarding", progress: 76 });
  writeLog("INFO", "[extract-shots] 完成", { projectId: project.id, shotCount: shots.length, elapsedMs: Date.now() - startedAt });
  response.json({ data: { project: updated, shots, engine: deepSeek.enabled ? deepSeekConfig.model : "local-fallback" } });
}));

app.post("/api/projects/:id/generate-script", asyncRoute(async (request, response) => {
  const projectId = String(request.params.id);
  const startedAt = Date.now();
  try {
    const project = await db.getProject(projectId);
    if (!project) return response.status(404).json({ error: "项目不存在" });
    const input = projectSchema.parse(request.body);
    const engine = deepSeek.enabled ? deepSeekConfig.model : "local-fallback";
    writeLog("INFO", "[generate-script] 开始", {
      projectId,
      title: input.title,
      genre: input.genre,
      durationSeconds: input.durationSeconds,
      targetEpisodeCount: input.targetEpisodeCount,
      loglineLength: input.logline.length,
      inputTokenBudget: SCRIPT_GENERATION_INPUT_TOKEN_BUDGET,
      outputTokenBudget: SCRIPT_GENERATION_OUTPUT_TOKEN_BUDGET,
      engine,
    });
    if (!deepSeek.enabled && !localFallback) return response.status(503).json({ error: "尚未配置 DeepSeek API Key，请先打开模型设置" });
    const updated = await db.updateProject(project.id, { ...input, status: "scripting", progress: 12 });
    if (!updated) return response.status(404).json({ error: "项目不存在" });
    const scriptText = deepSeek.enabled ? await deepSeek.generateScript(input) : scriptFromProject(input);
    if (scriptText.length > 200000) return response.status(422).json({ error: "生成的剧本超过 200000 字符限制，请缩短目标时长或调整项目设定" });
    const document = await db.saveScriptDocument(project.id, scriptText, "", "raw");
    writeLog("INFO", "[generate-script] 完成", { projectId, scriptLength: scriptText.length, elapsedMs: Date.now() - startedAt, engine });
    response.json({ data: { project: updated, scriptText, document, engine } });
  } catch (error) {
    writeLog("ERROR", "[generate-script] 失败", { projectId, elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.stack ?? error.message : String(error) });
    throw error;
  }
}));

app.patch("/api/projects/:id/shots/:shotId", asyncRoute(async (request, response) => {
  const projectId = String(request.params.id);
  const project = await db.getProject(projectId);
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const input = shotEditSchema.parse(request.body ?? {});
  const shot = await db.updateShot(projectId, String(request.params.shotId), input);
  if (!shot) return response.status(404).json({ error: "分镜不存在" });
  response.json({ data: shot });
}));

app.get("/api/projects/:id/shots/:shotId/continuity-preview", asyncRoute(async (request, response) => {
  const projectId = String(request.params.id);
  const shotId = String(request.params.shotId);
  const project = await db.getProject(projectId);
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const shots = await db.listShots(projectId);
  const shot = shots.find((candidate) => candidate.id === shotId);
  if (!shot) return response.status(404).json({ error: "分镜不存在" });
  const previousShot = shots
    .filter((candidate) => candidate.episodeNumber === shot.episodeNumber && candidate.shotOrder < shot.shotOrder)
    .sort((left, right) => right.shotOrder - left.shotOrder)[0];
  if (!previousShot) {
    return response.json({ data: { status: "first-shot", previousShotId: null, tailFrameUrl: null, message: "这是本集第一个镜头，无需承接上一镜头。" } });
  }
  const previousVideo = await latestCompletedVideo(projectId, previousShot.id);
  if (!previousVideo) {
    return response.json({ data: { status: "missing-video", previousShotId: previousShot.id, tailFrameUrl: null, message: "上一镜头视频尚未生成，暂时无法提取尾帧。" } });
  }
  try {
    const tailFrameUrl = await continuityTailFrame(previousVideo, projectId, previousShot.id);
    return response.json({ data: { status: "ready", previousShotId: previousShot.id, tailFrameUrl, message: "已提取上一镜头稳定尾帧，动作续接时将作为当前镜头首帧。" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeLog("WARN", "[continuity-preview] 尾帧预览提取失败", { projectId, shotId, previousShotId: previousShot.id, error: message });
    return response.json({ data: { status: "extract-failed", previousShotId: previousShot.id, tailFrameUrl: null, message } });
  }
}));

app.post("/api/projects/:id/render", asyncRoute(async (request, response) => {
  const project = await db.getProject(String(request.params.id));
  if (!project) return response.status(404).json({ error: "项目不存在" });
  if (!videoGeneration.enabled) return response.status(503).json({ error: "尚未配置视频生成 API Key，请先打开模型设置" });
  const input = renderInputSchema.parse(request.body ?? {});
  const shots = await db.listShots(project.id);
  if (!shots.length) return response.status(409).json({ error: "请先完成分镜提取" });
  const selectedShot = input.shotId ? shots.find((shot) => shot.id === input.shotId) : undefined;
  if (input.shotId && !selectedShot) return response.status(404).json({ error: "分镜不存在" });
  const subjects = await db.listSubjects(project.id);
  const targetShots = selectedShot ? [selectedShot] : shots;
  const jobs: RenderJob[] = [];
  for (const shot of targetShots) {
    jobs.push(await db.createRenderJob(project.id, shot.id, "volcengine", undefined, "queued", 0));
  }
  await db.updateProject(project.id, { status: "rendering", progress: Math.max(project.progress, 52) });
  await broadcastRenderJobs();
  const requestBase = `${request.protocol}://${request.get("host")}`;
  void processRenderSequence({ project, shots: targetShots, allShots: shots, jobs, subjects, renderInput: input, requestBase });
  response.status(202).json({ data: { ...(jobs[0] ?? {}), queuedShotCount: jobs.length, videoModel: input.model ?? getVideoSettings().model, continuityMode: requestedContinuityMode(input) } });
}));

app.get("/api/projects/:id/video-merges", asyncRoute(async (request, response) => {
  const project = await db.getProject(String(request.params.id));
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const records = await listVideoMerges(project.id);
  const recordsWithCovers = await Promise.all(records.map(async (record) => {
    if (record.coverUrl) return record;
    try {
      const videoPath = resolve(videoMergeDirectory, basename(record.outputUrl));
      const coverUrl = await createProjectCoverFromMerge(project.id, record.id, videoPath);
      const updatedRecord = { ...record, coverUrl };
      const recordPath = resolve(videoMergeDirectory, `${basename(record.outputUrl, ".mp4")}.json`);
      await writeFile(recordPath, JSON.stringify(updatedRecord, null, 2), "utf8");
      return updatedRecord;
    } catch (error) {
      writeLog("WARN", "[video-merge] 历史合成视频封面补建失败", { projectId: project.id, mergeId: record.id, error: error instanceof Error ? error.message : String(error) });
      return { ...record, coverUrl: null };
    }
  }));
  const latestCoverUrl = recordsWithCovers[0]?.coverUrl;
  if (latestCoverUrl && project.coverUrl !== latestCoverUrl) {
    await db.updateProject(project.id, { coverUrl: latestCoverUrl });
  }
  response.json({ data: recordsWithCovers.map((record) => ({ ...record, coverUrl: record.coverUrl ?? null })) });
}));

app.post("/api/projects/:id/video-merges", asyncRoute(async (request, response) => {
  const project = await db.getProject(String(request.params.id));
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const input = videoMergeSchema.parse(request.body ?? {});
  const selectedIds = new Set(input.shotIds);
  if (selectedIds.size !== input.shotIds.length) return response.status(400).json({ error: "不能重复选择同一个镜头" });

  const shots = (await db.listShots(project.id))
    .filter((shot) => selectedIds.has(shot.id))
    .sort((left, right) => left.episodeNumber - right.episodeNumber || left.shotOrder - right.shotOrder);
  if (shots.length !== input.shotIds.length) return response.status(404).json({ error: "部分分镜不存在" });

  const latestJobs = (await db.listJobs())
    .filter((job) => job.projectId === project.id && job.shotId && job.status === "completed" && job.outputUrl)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const videoByShot = new Map<string, string>();
  for (const job of latestJobs) if (job.shotId && job.outputUrl && !videoByShot.has(job.shotId)) videoByShot.set(job.shotId, job.outputUrl);
  const missing = shots.filter((shot) => !videoByShot.has(shot.id));
  if (missing.length) return response.status(409).json({ error: `有 ${missing.length} 个镜头尚未生成完成，请重新选择` });

  const mergeId = randomUUID();
  const fileStem = `${project.id}-${Date.now()}-${mergeId}`;
  const outputName = `${fileStem}.mp4`;
  const outputPath = resolve(videoMergeDirectory, outputName);
  const temporaryDirectory = resolve(videoMergeDirectory, `.tmp-${mergeId}`);
  const requestBase = `${request.protocol}://${request.get("host")}`;
  mkdirSync(temporaryDirectory, { recursive: true });

  try {
    const inputPaths: string[] = [];
    for (const [index, shot] of shots.entries()) {
      const inputPath = resolve(temporaryDirectory, `${String(index + 1).padStart(3, "0")}-${shot.id}.mp4`);
      await downloadMergeInput(videoByShot.get(shot.id)!, inputPath, requestBase);
      inputPaths.push(inputPath);
    }
    await runVideoMerge(inputPaths, outputPath, resolve(temporaryDirectory, "inputs.txt"));
    let coverUrl: string | null = null;
    try {
      coverUrl = await createProjectCoverFromMerge(project.id, mergeId, outputPath);
      await db.updateProject(project.id, { coverUrl });
    } catch (error) {
      writeLog("WARN", "[video-merge] 合并成功但项目封面提取失败", { projectId: project.id, mergeId, error: error instanceof Error ? error.message : String(error) });
    }
    const record: StoredVideoMerge = {
      id: mergeId,
      projectId: project.id,
      outputUrl: `/api/generated/merges/${outputName}`,
      shotIds: shots.map((shot) => shot.id),
      durationSeconds: shots.reduce((sum, shot) => sum + shot.durationSeconds, 0),
      createdAt: new Date().toISOString(),
      coverUrl,
    };
    await writeFile(resolve(videoMergeDirectory, `${fileStem}.json`), JSON.stringify(record, null, 2), "utf8");
    writeLog("INFO", "[video-merge] 合并完成", { projectId: project.id, mergeId, shotCount: shots.length, outputUrl: record.outputUrl });
    response.status(201).json({ data: record });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}));

app.get("/api/jobs", asyncRoute(async (_request, response) => {
  response.json({ data: await db.listJobs() });
}));

app.get("/api/jobs/stream", asyncRoute(async (request, response) => {
  response.set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
  renderJobStreams.add(response);
  response.write(`retry: 10000\ndata: ${JSON.stringify(await db.listJobs())}\n\n`);
  const heartbeat = setInterval(() => response.write(": keep-alive\n\n"), 25000);
  request.on("close", () => {
    clearInterval(heartbeat);
    renderJobStreams.delete(response);
  });
}));

app.use((_request, response) => response.status(404).json({ error: "接口不存在" }));

app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    return response.status(400).json({ error: "请求参数不完整", details: error.issues });
  }
  const detail = error instanceof Error ? error.message : "未知错误";
  writeLog("ERROR", "[api-error]", { method: request.method, path: request.originalUrl, error: error instanceof Error ? error.stack ?? detail : detail });
  const timedOut = detail.includes("请求超过") || detail.toLowerCase().includes("timeout");
  const modelResponseIssue = detail.includes("DeepSeek 返回空内容") || detail.includes("DeepSeek 返回了无法解析的 JSON");
  const imageResponseIssue = detail.includes("图片平台") || detail.includes("生成图片") || detail.includes("异步任务");
  const videoResponseIssue = detail.includes("视频平台") || detail.includes("视频任务") || detail.includes("视频生成") || detail.includes("视频合并") || detail.includes("FFmpeg") || detail.includes("镜头视频");
  response.status(timedOut ? 504 : modelResponseIssue || imageResponseIssue || videoResponseIssue ? 502 : 500).json({ error: timedOut ? "模型请求超时" : modelResponseIssue ? "模型返回结果异常" : imageResponseIssue ? "图片生成失败" : videoResponseIssue ? "视频处理失败" : "服务器内部错误", details: detail });
});

await db.initialize();
await resumeVideoTasks();
await resumeStudioVideoTasks();
app.listen(port, () => {
  writeLog("INFO", "[server] 启动完成", { url: `http://localhost:${port}`, database: databaseUrl.startsWith("mysql://") ? "mysql" : "sqlite", logFile });
});
