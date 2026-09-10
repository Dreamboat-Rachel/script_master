import "dotenv/config";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { appendFileSync, mkdirSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { z } from "zod";
import { createDatabaseStore } from "./database.js";
import { configureImage, getImageSettings, imageConfig, ImageGenerationService } from "./image.js";
import { configureVideo, getVideoSettings, VideoGenerationService } from "./video.js";
import { configureDeepSeek, deepSeekConfig, DeepSeekService, getDeepSeekSettings, SCRIPT_GENERATION_INPUT_TOKEN_BUDGET, SCRIPT_GENERATION_OUTPUT_TOKEN_BUDGET } from "./llm.js";
import type { Shot } from "./types.js";

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
const videoGeneration = new VideoGenerationService();
const renderJobStreams = new Set<Response>();

mkdirSync(logDirectory, { recursive: true });
mkdirSync(subjectImageDirectory, { recursive: true });

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

function publicMediaUrl(value: string, request: Request) {
  if (/^https?:\/\//i.test(value)) return value;
  const configuredBase = process.env.VIDEO_PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  const requestBase = `${request.protocol}://${request.get("host")}`;
  return `${configuredBase || requestBase}${value.startsWith("/") ? value : `/${value}`}`;
}

function imageMimeType(value: string) {
  const extension = value.toLowerCase().split(".").pop();
  return extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "webp" ? "image/webp" : "image/png";
}

async function referenceImageSource(value: string, request: Request) {
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  const configuredBase = process.env.VIDEO_PUBLIC_BASE_URL?.trim();
  if (configuredBase) return publicMediaUrl(value, request);
  try {
    const filePath = resolve(subjectImageDirectory, basename(value));
    const bytes = await readFile(filePath);
    return `data:${imageMimeType(value)};base64,${bytes.toString("base64")}`;
  } catch {
    return publicMediaUrl(value, request);
  }
}

async function pollVideoTask(jobId: string, projectId: string, taskId: string) {
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const task = await videoGeneration.getTask(taskId);
      await db.updateRenderJob(jobId, {
        status: task.status,
        progress: task.progress,
        outputUrl: task.videoUrl ?? null,
        errorMessage: task.errorMessage ?? null,
      });
      await broadcastRenderJobs();
      if (task.status === "completed" || task.status === "failed") {
        const jobs = (await db.listJobs()).filter((job) => job.projectId === projectId);
        const active = jobs.some((job) => job.status === "queued" || job.status === "processing");
        if (!active) await db.updateProject(projectId, { status: jobs.some((job) => job.status === "failed") ? "failed" : "completed", progress: jobs.some((job) => job.status === "failed") ? 76 : 100 });
        return;
      }
      await wait(5000);
    }
    await db.updateRenderJob(jobId, { status: "failed", progress: 0, errorMessage: "视频任务轮询超时" });
    await broadcastRenderJobs();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.updateRenderJob(jobId, { status: "failed", progress: 0, errorMessage: message }).catch(() => undefined);
    await broadcastRenderJobs().catch(() => undefined);
    writeLog("ERROR", "[render] 查询视频任务失败", { jobId, taskId, error: message });
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
app.use(express.json({ limit: "12mb" }));
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
  logline: z.string().trim().min(8).max(5000),
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
  continuity: z.boolean().default(true),
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

function videoPromptForShot(shot: Shot, input: z.infer<typeof renderInputSchema>, previousShot?: Shot) {
  const dialogue = dialogueWithoutNarration(shot.dialogue);
  const audioMode = input.audioMode === "dialogue" && !dialogue ? "ambient" : input.audioMode;
  const basePrompt = input.prompt ?? [
    `镜头：${shot.title}`,
    `场景：${shot.location}`,
    `动作：${shot.action}`,
    `摄影：${shot.camera}`,
    `画面：${shot.visualPrompt}`,
  ].join("\n");
  const continuityPrompt = input.continuity && previousShot ? [
    "连续性要求：当前镜头必须从上一镜头的结束状态自然开始，不重复上一镜头动作。",
    `上一镜头场景：${previousShot.location}`,
    `上一镜头结束动作：${previousShot.action}`,
    `上一镜头画面状态：${previousShot.visualPrompt}`,
    "保持同一人物的面容、发型、服装、体态和所持道具一致；保持空间方位、光线、天气、色调和运动方向连续。",
  ].join("\n") : "连续性要求：本镜头独立生成。";
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
  return [basePrompt, continuityPrompt, audioPrompt, musicPrompt, "画面中不要生成字幕、标题、标牌式说明文字或水印。"].join("\n\n");
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
    { name: "午夜车站", role: "location" as const, description: "城市边缘的旧车站，雨后潮湿，只有一盏信号灯仍在工作。", visualPrompt: `${project.style}，午夜旧车站，雨后月台，孤独信号灯，远处城市灯火，场景设定图` },
    { name: "未来来信", role: "prop" as const, description: "一封没有寄件人的纸质信，落款日期是二十年以后。", visualPrompt: `${project.style}，泛黄信件，未来日期，湿润桌面，局部光线，道具设定图` },
  ];
}

function shotsFromEpisodes(projectId: string, episodes: Array<{ id: string; episodeNumber: number }>, style: string) {
  const templates = [
    ["月台建立", "午夜车站 / 月台", "雨水沿着站牌滴落，林默独自检查最后一盏灯。", "", "广角，雨后旧车站，孤独人物，电影级低照度，空气透视", "横移"],
    ["信件出现", "检票亭 / 内", "一封没有寄件人的信从售票窗口缓缓滑入。", "林默：这不可能。", "手部特写，泛黄信件，红色未来日期，悬疑氛围", "推近"],
    ["列车入站", "远端月台 / 外", "远处没有轨道的方向亮起车灯，铁轨开始震动。", "广播：请最后一位乘客上车。", "超现实列车冲入黑夜，雾气，冷蓝与暖橙对撞，史诗构图", "快速拉远"],
  ];
  return episodes.flatMap((episode) => templates.map((template, index) => ({ episodeId: episode.id, episodeNumber: episode.episodeNumber, shotOrder: index + 1, title: `${String(index + 1).padStart(2, "0")} · ${template[0]}`, location: template[1], action: template[2], dialogue: template[3], visualPrompt: `${style}，${template[4]}`, camera: template[5], durationSeconds: index === 2 ? 8 : 6, status: "ready" as const })));
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

app.get("/api/dashboard", asyncRoute(async (_request, response) => {
  const [projects, jobs] = await Promise.all([db.listProjects(), db.listJobs()]);
  const completed = projects.filter((project) => project.status === "completed").length;
  response.json({
    stats: {
      projectCount: projects.length,
      completedCount: completed,
      activeRenders: jobs.filter((job) => ["queued", "processing"].includes(job.status)).length,
      generatedSeconds: projects.reduce((sum, project) => sum + (project.status === "completed" ? project.durationSeconds : 0), 0),
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
  const jobs = [];
  let referenceFallback = false;
  for (const shot of targetShots) {
    const previousShot = shots
      .filter((candidate) => candidate.episodeNumber === shot.episodeNumber && candidate.shotOrder < shot.shotOrder)
      .sort((left, right) => right.shotOrder - left.shotOrder)[0];
    const content = [shot.title, shot.location, shot.action, shot.dialogue, shot.visualPrompt].join(" ");
    const referenceSubjects = (input.referenceSubjectIds.length
      ? subjects.filter((subject) => input.referenceSubjectIds.includes(subject.id))
      : subjects.filter((subject) => subject.imageUrl && subject.name.trim() && content.includes(subject.name.trim()))).filter((subject) => subject.imageUrl);
    const task = await videoGeneration.createTask({
      prompt: videoPromptForShot(shot, { ...input, prompt: selectedShot ? input.prompt : undefined }, previousShot),
      model: input.model,
      referenceImageUrls: await Promise.all(referenceSubjects.map((subject) => referenceImageSource(subject.imageUrl!, request))),
      ratio: project.aspectRatio,
      duration: input.duration ?? shot.durationSeconds,
      generateAudio: input.audioMode !== "silent",
    });
    referenceFallback ||= task.referenceFallback;
    writeLog("INFO", "[render] 已提交视频任务", {
      projectId: project.id,
      shotId: shot.id,
      taskId: task.taskId,
      status: task.status,
      referenceFallback: task.referenceFallback,
      referenceSubjectIds: referenceSubjects.map((subject) => subject.id),
      audioMode: input.audioMode,
      speechRate: input.speechRate,
      bgm: input.bgm,
      continuity: input.continuity,
    });
    const job = await db.createRenderJob(project.id, shot.id, "volcengine", task.taskId, task.status, task.progress);
    jobs.push(job);
    if (task.status === "completed" && task.videoUrl) await db.updateRenderJob(job.id, { status: "completed", progress: 100, outputUrl: task.videoUrl });
    await broadcastRenderJobs();
    void pollVideoTask(job.id, project.id, task.taskId);
  }
  await db.updateProject(project.id, { status: "rendering", progress: Math.max(project.progress, 52) });
  response.status(202).json({ data: { ...(jobs[0] ?? {}), videoModel: input.model ?? getVideoSettings().model, referenceFallback } });
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
  const videoResponseIssue = detail.includes("视频平台") || detail.includes("视频任务") || detail.includes("视频生成");
  response.status(timedOut ? 504 : modelResponseIssue || imageResponseIssue || videoResponseIssue ? 502 : 500).json({ error: timedOut ? "模型请求超时" : modelResponseIssue ? "模型返回结果异常" : imageResponseIssue ? "图片生成失败" : videoResponseIssue ? "视频生成失败" : "服务器内部错误", details: detail });
});

await db.initialize();
await resumeVideoTasks();
app.listen(port, () => {
  writeLog("INFO", "[server] 启动完成", { url: `http://localhost:${port}`, database: databaseUrl.startsWith("mysql://") ? "mysql" : "sqlite", logFile });
});
