import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Episode, EpisodeCharacter, Shot, Subject } from "./types.js";

const configuredApiKey = process.env.DEEPSEEK_API_KEY?.trim();
const isPlaceholderKey = (value: string) => /^your(?:_|-)deepseek(?:_|-)api(?:_|-)key$/i.test(value);
let runtimeApiKey = configuredApiKey && !isPlaceholderKey(configuredApiKey) ? configuredApiKey : undefined;
let runtimeModel = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
let runtimeApiBase = (process.env.DEEPSEEK_API_BASE ?? "https://api.deepseek.com").replace(/\/$/, "");

function updateEnvFile(values: Record<string, string>) {
  const envPath = resolve(process.cwd(), ".env");
  let content = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value.replace(/[\r\n]/g, "")}`;
    const matcher = new RegExp(`^${key}=.*$`, "m");
    content = matcher.test(content) ? content.replace(matcher, line) : `${content}${content && !content.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  writeFileSync(envPath, content, "utf8");
}

export const deepSeekConfig = {
  get model() { return runtimeModel; },
  get apiBase() { return runtimeApiBase; },
  get enabled() { return Boolean(runtimeApiKey); },
};

export function getDeepSeekSettings() {
  return { model: runtimeModel, apiBase: runtimeApiBase, configured: Boolean(runtimeApiKey) };
}

export function configureDeepSeek(input: { apiKey?: string; model?: string; apiBase?: string }) {
  if (input.apiKey !== undefined) {
    const nextKey = input.apiKey.trim();
    runtimeApiKey = nextKey && !isPlaceholderKey(nextKey) ? nextKey : undefined;
  }
  if (input.model) runtimeModel = input.model.trim();
  if (input.apiBase) runtimeApiBase = input.apiBase.trim().replace(/\/$/, "");
  updateEnvFile({ DEEPSEEK_API_KEY: runtimeApiKey ?? "", DEEPSEEK_MODEL: runtimeModel, DEEPSEEK_API_BASE: runtimeApiBase });
  return getDeepSeekSettings();
}

type JsonObject = Record<string, unknown>;

function parseJson(content: string): JsonObject {
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("DeepSeek 返回了无法解析的 JSON");
  return JSON.parse(cleaned.slice(start, end + 1)) as JsonObject;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function exactText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function number(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function episodeCharacter(value: unknown): EpisodeCharacter {
  const row = (value ?? {}) as JsonObject;
  return {
    name: text(row.name, "未设定"),
    introduction: text(row.introduction, "未设定"),
    costume: text(row.costume, "未设定"),
    personality: text(row.personality, "未设定"),
    expressions: text(row.expressions, "未设定"),
    continuityNotes: text(row.continuityNotes, "未设定"),
  };
}

export class DeepSeekService {
  get enabled() { return Boolean(runtimeApiKey); }

  private async complete(system: string, user: string) {
    if (!runtimeApiKey) throw new Error("未配置 DEEPSEEK_API_KEY");
    const response = await fetch(`${runtimeApiBase}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${runtimeApiKey}` },
      body: JSON.stringify({
        model: runtimeModel,
        temperature: 0.15,
        max_tokens: 16000,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error(`DeepSeek API ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("DeepSeek 没有返回内容");
    return parseJson(content);
  }

  async generateScript(input: {
    title: string;
    logline: string;
    genre: string;
    style: string;
    aspectRatio: string;
    durationSeconds: number;
  }) {
    const result = await this.complete(
      `你是专业影视编剧。请根据用户提供的项目设定，生成一份完整、原创、可继续交给剧本格式化模型处理的中文影视剧本。
硬性规则：
1. 只输出 JSON，不要 Markdown 代码围栏、解释文字或创作说明，格式必须是 {"scriptText":"..."}。
2. scriptText 必须是完整剧本正文，不能是大纲、梗概、分镜提示词或几句示例。
3. 剧本必须有清晰标题、类型信息、人物首次出场、场次编号、时间地点、动作、对白、冲突推进、转折和结尾。
4. 开场要有可视化的钩子，中段要有明确升级的冲突，结尾要留下完整的情绪落点；所有情节都要围绕一句话简介展开。
5. 目标时长只作为篇幅和节奏约束，画面比例和视觉风格只作为创作约束；不要在剧本文本里堆砌技术参数。
6. 人物行为、对白和场景细节要具体可拍，前后保持一致。`,
      JSON.stringify({ task: "generate_complete_screenplay", project: input }),
    );
    const scriptText = text(result.scriptText);
    if (scriptText.length < 100) throw new Error("DeepSeek 返回的剧本内容过短");
    return scriptText;
  }

  async formatScript(originalText: string) {
    const result = await this.complete(
      `你是资深影视剧本编辑。你的任务是把用户提供的剧本整理成专业、可供后续分集和分镜模型读取的标准格式。
硬性规则：
1. 绝对不能删减、概括、改写、翻译、合并或臆造用户原文中的任何信息，包括对白、动作、时间、地点、数字、专有名词、括号内容和语气词。
2. 只允许增加结构标签、编号和版式，不允许改变原文字符顺序。
3. 如果一行无法判断类型，放入“原文备注”，保留该行原文。
4. 输出必须是 JSON，不要 Markdown 代码围栏。formattedText 必须是完整剧本，sourceAudit 必须等于用户原文逐字内容。`,
      JSON.stringify({ task: "format_screenplay_without_loss", sourceText: originalText }),
    );
    const formatted = text(result.formattedText);
    const sourceAudit = exactText(result.sourceAudit);
    if (!formatted || sourceAudit !== originalText) throw new Error("格式化结果未通过原文保真校验");
    return { formattedText: `${formatted}\n\n【原文逐字归档 / SOURCE AUDIT】\n${originalText}`, qualityReport: text(result.qualityReport, "已完成原文保真校验") };
  }

  async extractEpisodes(formattedText: string, originalText: string): Promise<Array<Omit<Episode, "id" | "projectId" | "sceneCount" | "createdAt" | "updatedAt">>> {
    const result = await this.complete(
      `你是影视制片结构分析师。请从标准剧本中划分自然的剧情分集，并返回可以直接交给主体提取和分镜生成的完整结构化数据。
硬性规则：
1. 只基于剧本事实，不补写、不推测、不省略任何已出现的剧情信息。
2. originalText 必须从 sourceText 中逐字摘录本集覆盖的原文，保留对白、动作、场次、时间、地点、数字、括号和换行语义；不能改写或概括。
3. hook 写本集开场钩子或最先建立的悬念；如果原文没有明确钩子，写“未明确设定”，不能臆造。
4. plotNodes 按原文顺序列出情节节点，至少覆盖场景建立、冲突/行动、转折和结尾状态；每个节点必须是简洁的事实描述。
5. characters 只列出本集实际出现或被明确提及、且会参与画面的角色。每个角色必须填写 introduction、costume、personality、expressions、continuityNotes；原文没有的信息统一写“未设定”。
6. episodeNumber 从 1 连续编号，status 固定为 ready。summary 是事实摘要，不代替 originalText。
只输出 JSON，不要 Markdown 代码围栏，格式必须是：{"episodes":[{"episodeNumber":1,"title":"","summary":"","hook":"","originalText":"","plotNodes":[],"characters":[{"name":"","introduction":"","costume":"","personality":"","expressions":"","continuityNotes":""}],"status":"ready"}]}。`,
      JSON.stringify({ formattedScreenplay: formattedText, sourceText: originalText }),
    );
    const episodes = Array.isArray(result.episodes) ? result.episodes : [];
    if (!episodes.length) throw new Error("DeepSeek 没有返回分集结果");
    return episodes.map((item, index) => {
      const row = item as JsonObject;
      const rawCharacters = Array.isArray(row.characters) ? row.characters : [];
      const characters = rawCharacters.map(episodeCharacter).filter((character, characterIndex, all) => all.findIndex((candidate) => candidate.name === character.name) === characterIndex);
      return {
        episodeNumber: index + 1,
        title: text(row.title, `第 ${index + 1} 集`),
        summary: text(row.summary, "待补充本集摘要"),
        hook: text(row.hook, "未明确设定"),
        originalText: exactText(row.originalText),
        plotNodes: stringList(row.plotNodes),
        characters,
        status: "ready" as const,
      };
    });
  }

  async extractSubjects(formattedText: string, style: string): Promise<Array<Omit<Subject, "id" | "projectId" | "createdAt" | "updatedAt">>> {
    const result = await this.complete(
      `你是影视美术与资产设定师。请从剧本中提取所有会影响画面一致性的主体，包含主要角色、反复出现的地点和关键道具。不要遗漏只出现一次但对剧情重要的主体。输出 JSON: {"subjects":[{"name":"","role":"character|location|prop","description":"","visualPrompt":""}]}。visualPrompt 要可直接用于图像模型，必须只根据剧本事实，未知信息明确写“未设定”，不得臆造年龄、肤色或品牌。`,
      JSON.stringify({ style, formattedScreenplay: formattedText }),
    );
    const subjects = Array.isArray(result.subjects) ? result.subjects : [];
    if (!subjects.length) throw new Error("DeepSeek 没有返回主体结果");
    const seen = new Set<string>();
    return subjects.flatMap((item) => {
      const row = item as JsonObject;
      const roleValue = text(row.role, "character");
      const role = roleValue === "location" || roleValue === "prop" ? roleValue : "character";
      const name = text(row.name, "未命名主体");
      const key = `${role}:${name}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ name, role, description: text(row.description, "未设定"), visualPrompt: text(row.visualPrompt, `${style}，${name}`) }];
    });
  }

  async extractShots(formattedText: string, episodes: Array<{ id: string; episodeNumber: number }>, subjects: Subject[], style: string): Promise<Array<Omit<Shot, "id" | "projectId" | "createdAt" | "updatedAt">>> {
    const result = await this.complete(
      `你是影视分镜导演。请基于剧本、分集和主体资产生成可直接用于视频生成的镜头清单。必须覆盖原文剧情，不得跳过对白或关键动作；每个镜头只表达一个主要视觉动作。输出 JSON: {"shots":[{"episodeNumber":1,"shotOrder":1,"title":"","location":"","action":"","dialogue":"","visualPrompt":"","camera":"","durationSeconds":6,"status":"ready"}]}。shotOrder 在每集内从 1 连续编号。visualPrompt 要包含主体、环境、光线、情绪和连续性要求；对白原文保留；不得臆造剧本没有的剧情。`,
      JSON.stringify({ style, subjects, episodes: episodes.map(({ id: _id, ...episode }) => episode), formattedScreenplay: formattedText }),
    );
    const shots = Array.isArray(result.shots) ? result.shots : [];
    if (!shots.length) throw new Error("DeepSeek 没有返回分镜结果");
    const episodeIds = new Map(episodes.map((episode) => [episode.episodeNumber, episode.id]));
    const nextOrder = new Map<number, number>();
    return shots.map((item, index) => {
      const row = item as JsonObject;
      const requestedEpisode = Math.round(number(row.episodeNumber, 1));
      const episodeNumber = episodeIds.has(requestedEpisode) ? requestedEpisode : episodes[Math.min(index, episodes.length - 1)].episodeNumber;
      const shotOrder = (nextOrder.get(episodeNumber) ?? 0) + 1;
      nextOrder.set(episodeNumber, shotOrder);
      return { episodeId: episodeIds.get(episodeNumber)!, episodeNumber, shotOrder, title: text(row.title, `镜头 ${index + 1}`), location: text(row.location, "未设定"), action: text(row.action, "未设定"), dialogue: text(row.dialogue), visualPrompt: text(row.visualPrompt, `${style}，${text(row.action, "场景")}`), camera: text(row.camera, "中景"), durationSeconds: Math.min(30, Math.max(2, Math.round(number(row.durationSeconds, 6)))), status: "ready" as const };
    });
  }
}
