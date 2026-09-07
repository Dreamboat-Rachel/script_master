import "dotenv/config";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { createDatabaseStore } from "./database.js";
import { configureDeepSeek, deepSeekConfig, DeepSeekService, getDeepSeekSettings, SCRIPT_GENERATION_INPUT_TOKEN_BUDGET, SCRIPT_GENERATION_OUTPUT_TOKEN_BUDGET } from "./llm.js";

const port = Number(process.env.PORT ?? 8787);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const databaseUrl = process.env.DATABASE_URL ?? "sqlite://./data/script-master.db";
const db = createDatabaseStore(databaseUrl);
const deepSeek = new DeepSeekService();
const localFallback = process.env.LOCAL_FALLBACK === "true";
const logDirectory = resolve(process.cwd(), "logs");
const logFile = resolve(logDirectory, "backend.log");

mkdirSync(logDirectory, { recursive: true });

function writeLog(level: "INFO" | "WARN" | "ERROR", message: string, data?: Record<string, unknown>) {
  const line = `${new Date().toISOString()} [${level}] ${message}${data ? ` ${JSON.stringify(data)}` : ""}`;
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.info(line);
  try { appendFileSync(logFile, `${line}\n`, "utf8"); }
  catch (error) { console.error("[logger] 日志文件写入失败", error); }
}

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: clientOrigin }));
app.use(express.json({ limit: "2mb" }));
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
    const result = await deepSeek.formatScript(text);
    formattedText = result.formattedText;
    qualityReport = result.qualityReport;
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

app.post("/api/projects/:id/render", asyncRoute(async (request, response) => {
  const project = await db.getProject(String(request.params.id));
  if (!project) return response.status(404).json({ error: "项目不存在" });
  const shots = await db.listShots(project.id);
  if (!shots.length) return response.status(409).json({ error: "请先完成分镜提取" });
  const job = await db.createRenderJob(project.id);
  await db.updateProject(project.id, { status: "rendering", progress: Math.max(project.progress, 52) });
  response.status(202).json({ data: job });
}));

app.get("/api/jobs", asyncRoute(async (_request, response) => {
  response.json({ data: await db.listJobs() });
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
  response.status(timedOut ? 504 : modelResponseIssue ? 502 : 500).json({ error: timedOut ? "模型请求超时" : modelResponseIssue ? "模型返回结果异常" : "服务器内部错误", details: detail });
});

await db.initialize();
app.listen(port, () => {
  writeLog("INFO", "[server] 启动完成", { url: `http://localhost:${port}`, database: databaseUrl.startsWith("mysql://") ? "mysql" : "sqlite", logFile });
});
