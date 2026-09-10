import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Episode, EpisodeCharacter, Shot, Subject } from "./types.js";

const configuredApiKey = process.env.DEEPSEEK_API_KEY?.trim();
const isPlaceholderKey = (value: string) => /^your(?:_|-)deepseek(?:_|-)api(?:_|-)key$/i.test(value);
let runtimeApiKey = configuredApiKey && !isPlaceholderKey(configuredApiKey) ? configuredApiKey : undefined;
let runtimeModel = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
let runtimeApiBase = (process.env.DEEPSEEK_API_BASE ?? "https://api.deepseek.com").replace(/\/$/, "");

export const SCRIPT_GENERATION_INPUT_TOKEN_BUDGET = 64000;
export const SCRIPT_GENERATION_OUTPUT_TOKEN_BUDGET = 128000;

export function updateEnvFile(values: Record<string, string>) {
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

// Chinese text is close to one token per character; keep the prompt within the requested budget.
function estimateTokens(value: string) {
  return Array.from(value).length;
}

function isTimeoutError(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { name?: string }).name === "TimeoutError");
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

  private async complete(system: string, user: string, options: { timeoutMs?: number; maxTokens?: number; inputTokenBudget?: number } = {}) {
    if (!runtimeApiKey) throw new Error("未配置 DEEPSEEK_API_KEY");
    const timeoutMs = options.timeoutMs ?? 120000;
    const maxTokens = options.maxTokens ?? 16000;
    if (options.inputTokenBudget && estimateTokens(`${system}\n${user}`) > options.inputTokenBudget) {
      throw new Error(`模型输入超过 ${options.inputTokenBudget} token 限制，请缩短项目简介后重试`);
    }
    let response: Response;
    try {
      response = await fetch(`${runtimeApiBase}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${runtimeApiKey}` },
        body: JSON.stringify({
          model: runtimeModel,
          temperature: 0.15,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) throw new Error(`DeepSeek 请求超过 ${Math.round(timeoutMs / 60000)} 分钟仍未完成，请稍后重试或缩短剧本内容`);
      throw error;
    }
    if (!response.ok) throw new Error(`DeepSeek API ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const payload = await response.json() as {
      choices?: Array<{
        finish_reason?: string | null;
        message?: { content?: string | Array<{ type?: string; text?: string }> | null; reasoning_content?: string | null };
      }>;
      output_text?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const choice = payload.choices?.[0];
    const rawContent = choice?.message?.content;
    const content = typeof rawContent === "string"
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((part) => part.text ?? "").join("")
        : choice?.message?.reasoning_content ?? payload.output_text ?? "";
    if (!content.trim()) {
      const finishReason = choice?.finish_reason ?? "unknown";
      const usage = payload.usage?.total_tokens ? `，已用 ${payload.usage.total_tokens} token` : "";
      throw new Error(`DeepSeek 返回空内容（finish_reason: ${finishReason}${usage}）。请检查模型额度、上下文长度或稍后重试`);
    }
    return parseJson(content);
  }

  async generateScript(input: {
    title: string;
    logline: string;
    genre: string;
    style: string;
    aspectRatio: string;
    durationSeconds: number;
    targetEpisodeCount: number;
  }) {
    const systemPrompt = `你是专业影视编剧。请根据用户提供的项目设定，生成一份完整、原创、可继续交给剧本格式化模型处理的中文影视剧本。
硬性规则：
1. 只输出 JSON，不要 Markdown 代码围栏、解释文字或创作说明，格式必须是 {"scriptText":"..."}。
2. scriptText 必须是完整剧本正文，不能是大纲、梗概、分镜提示词或几句示例。
3. 剧本必须有清晰标题、类型信息、人物首次出场、场次编号、时间地点、动作、对白、冲突推进、转折和结尾。
4. 开场要有可视化的钩子，中段要有明确升级的冲突，结尾要留下完整的情绪落点；所有情节都要围绕一句话简介展开。
5. 目标时长只作为篇幅和节奏约束，画面比例和视觉风格只作为创作约束；不要在剧本文本里堆砌技术参数。
6. 人物行为、对白和场景细节要具体可拍，前后保持一致。
7. 以人物之间的对白、明确标注的内心 OS 和可拍摄动作推动剧情。不要使用旁白、解说或画外介绍替代画面表达；背景信息优先通过场景、道具和人物行为呈现。
8. 台词必须适合目标时长，避免长篇独白。介绍性台词或内心 OS 应简短、语气舒缓，并给画面和停顿留出时间。`;
    const userPrompt = [
      "请使用以下项目参数作为本次剧本生成的完整提示词，所有情节必须围绕这些参数展开：",
      `项目名称：${input.title}`,
      `一句话简介：${input.logline}`,
      `内容类型：${input.genre}`,
      `视觉风格：${input.style}`,
      `画面比例：${input.aspectRatio}`,
      `每集目标时长：${input.durationSeconds} 秒`,
      `目标集数：${input.targetEpisodeCount} 集`,
      "请现在生成完整中文影视剧本，并严格返回 {\"scriptText\":\"...\"}。",
    ].join("\n");
    const result = await this.complete(systemPrompt, userPrompt, {
      timeoutMs: 300000,
      inputTokenBudget: SCRIPT_GENERATION_INPUT_TOKEN_BUDGET,
      maxTokens: SCRIPT_GENERATION_OUTPUT_TOKEN_BUDGET,
    });
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
      { timeoutMs: 300000, maxTokens: SCRIPT_GENERATION_OUTPUT_TOKEN_BUDGET },
    );
    const formatted = text(result.formattedText);
    const sourceAudit = exactText(result.sourceAudit);
    if (!formatted || sourceAudit !== originalText) throw new Error("格式化结果未通过原文保真校验");
    return { formattedText: formatted, qualityReport: text(result.qualityReport, "已完成原文保真校验") };
  }

  async extractEpisodes(formattedText: string, targetDurationSeconds = 60, targetEpisodeCount = 3): Promise<Array<Omit<Episode, "id" | "projectId" | "sceneCount" | "createdAt" | "updatedAt">>> {
    const result = await this.complete(
      `你是影视制片结构分析师。请从标准剧本中划分自然的剧情分集，并返回可以直接交给主体提取和分镜生成的完整结构化数据。
硬性规则：
1. 只基于剧本事实，不补写、不推测、不省略任何已出现的剧情信息。
2. originalText 必须从 formattedScreenplay 中逐字摘录本集覆盖的格式化剧本内容，保留格式化后的场次、对白、动作、时间、地点、数字、括号和换行语义；不能改写或概括。这里的 originalText 是“本集格式化内容”，不是未格式化的原始剧本。
3. hook 写本集开场钩子或最先建立的悬念；如果原文没有明确钩子，写“未明确设定”，不能臆造。
4. plotNodes 按原文顺序列出情节节点，至少覆盖场景建立、冲突/行动、转折和结尾状态；每个节点必须是简洁的事实描述。
5. characters 只列出本集实际出现或被明确提及、且会参与画面的角色。每个角色必须填写 introduction、costume、personality、expressions、continuityNotes；原文没有的信息统一写“未设定”。
6. episodeNumber 从 1 连续编号，status 固定为 ready。summary 是事实摘要，不代替 originalText。
7. 目标集数为 ${targetEpisodeCount} 集，每集目标时长为 ${targetDurationSeconds} 秒；请尽量划分为指定集数，并据此安排每集内容量和节奏。若原文内容不足以自然拆分，不要编造剧情，但仍需返回连续的集数结构。
只输出 JSON，不要 Markdown 代码围栏，格式必须是：{"episodes":[{"episodeNumber":1,"title":"","summary":"","hook":"","originalText":"","plotNodes":[],"characters":[{"name":"","introduction":"","costume":"","personality":"","expressions":"","continuityNotes":""}],"status":"ready"}]}。`,
      JSON.stringify({ formattedScreenplay: formattedText, targetEpisodeDurationSeconds: targetDurationSeconds, targetEpisodeCount }),
      { timeoutMs: 300000, maxTokens: SCRIPT_GENERATION_OUTPUT_TOKEN_BUDGET },
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
        originalText: exactText(row.formattedText) || exactText(row.originalText),
        plotNodes: stringList(row.plotNodes),
        characters,
        status: "ready" as const,
      };
    });
  }

  async extractSubjects(formattedText: string, style: string): Promise<Array<Omit<Subject, "id" | "projectId" | "imageUrl" | "createdAt" | "updatedAt">>> {
    const result = await this.complete(
      `你是影视美术与资产设定师。请从剧本中提取所有会影响画面一致性的主体，包含主要角色、反复出现的地点和关键道具。不要遗漏只出现一次但对剧情重要的主体。
输出 JSON: {"subjects":[{"name":"","stage":"","role":"character|location|prop","description":"","visualPrompt":""}]}。

【人物阶段拆分规则，必须遵守】
1. 同一人物只要在剧本中出现两个或以上明确的年龄、人生阶段或造型阶段，必须拆成多个独立的 character 主体，绝对不能合并成一个主体，也不能把多个阶段写在同一个 description 或 visualPrompt 中。
2. 每个阶段的 name 必须是“原人物名-阶段”，例如：韩立-少儿、韩立-少年、韩立-青年。stage 字段只填写一个简短阶段名，例如“少儿”“少年”“青年”；如果 name 已经带阶段后缀，不要重复添加。
3. 阶段命名参考：儿童、幼年、年幼或少年早期写“少儿”；约十四至十八岁、十五岁写“少年”；成年、二十岁以上、二十五岁写“青年”；更高年龄按事实写“中年”或“老年”。如果前一阶段只写“少年”、后一阶段明确写“十五岁”，前者按更年幼阶段命名为“少儿”，后者命名为“少年”。例如同一人物第一集为少年、第二集十五岁、第三集二十五岁时，必须输出“原名-少儿”“原名-少年”“原名-青年”三个主体。不要因为人物同名就合并不同阶段。
4. 每个阶段只描述该阶段的年龄、身形、面容、发型、肤色、服装、固定道具和其他稳定识别特征。若某特征未设定，写“未设定”。不得把其他年龄阶段的信息带进来。
5. 地点和道具也要按视觉上确实不同的版本拆分；仅仅在不同场次出现、但外观没有变化的主体不要重复创建。

visualPrompt 是“主体设定提示词”，只用于生成该主体的独立设定图：描述主体本身的外观、材质、固定特征、服装或空间结构。禁止写具体镜头、景别、机位、构图、运镜、正在发生的动作、对白、光线氛围、其他阶段和其他主体；禁止把一段剧情改写成画面描述。必须只根据剧本事实，未知信息明确写“未设定”，不得臆造年龄、肤色或品牌。
      返回前自检：如果一个人物的 description 或 visualPrompt 中出现了两个年龄/阶段，必须拆成多个对象；每个阶段对象的 name 必须唯一。`,
      JSON.stringify({ style, formattedScreenplay: formattedText }),
      {
        timeoutMs: 300000,
        inputTokenBudget: SCRIPT_GENERATION_INPUT_TOKEN_BUDGET,
        maxTokens: SCRIPT_GENERATION_OUTPUT_TOKEN_BUDGET,
      },
    );
    const subjects = Array.isArray(result.subjects) ? result.subjects : [];
    if (!subjects.length) throw new Error("DeepSeek 没有返回主体结果");
    const seen = new Set<string>();
    return subjects.flatMap((item) => {
      const row = item as JsonObject;
      const roleValue = text(row.role, "character");
      const role = roleValue === "location" || roleValue === "prop" ? roleValue : "character";
      const rawName = text(row.name, "未命名主体");
      const stage = role === "character" ? text(row.stage) : "";
      const stageSeparator = stage ? ["-", "－", "—", "·", "•", "丨", "|", "｜"].find((separator) => rawName.endsWith(`${separator}${stage}`)) : undefined;
      const name = stage ? stageSeparator ? `${rawName.slice(0, -(stage.length + stageSeparator.length))}-${stage}` : `${rawName}-${stage}` : rawName;
      const key = `${role}:${name}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ name, role, description: text(row.description, "未设定"), visualPrompt: text(row.visualPrompt, `${style}，${name}`) }];
    });
  }

  async extractShots(formattedText: string, episodes: Array<{ id: string; episodeNumber: number }>, subjects: Subject[], style: string): Promise<Array<Omit<Shot, "id" | "projectId" | "createdAt" | "updatedAt">>> {
    const result = await this.complete(
      `你是影视分镜导演。请基于剧本、分集和主体资产生成可直接用于视频生成的镜头清单。必须覆盖原文剧情，不得跳过对白或关键动作；每个镜头只表达一个主要视觉动作。输出 JSON: {"shots":[{"episodeNumber":1,"shotOrder":1,"title":"","location":"","action":"","dialogue":"","visualPrompt":"","camera":"","durationSeconds":6,"status":"ready"}]}。shotOrder 在每集内从 1 连续编号。

对白规则：
1. dialogue 只能填写原文中人物实际说出的对白或原文明确标注的内心 OS，保留人物名和原文措辞；格式使用“人物名：原文台词”或“人物名（OS）：原文内容”。
2. 禁止把场景说明、动作、背景介绍、人物心理推测改写成旁白、解说、画外音或新增台词。原文没有对白或 OS 时，dialogue 必须为空字符串。
3. 不要为了填满镜头时长增加台词。较长原文对白应按自然语义拆到连续镜头中，每个镜头的台词量必须能以自然或舒缓语速在 durationSeconds 内说完。

连续性规则：
1. visualPrompt 要包含主体、环境、光线、情绪、本镜头开场状态和结束状态；相邻镜头的“结束状态 → 开场状态”必须能直接衔接。
2. 同一场景的相邻镜头必须保持人物外观与服装、道具、空间方位、光线、天气、色调和运动方向一致，除非原文明确发生变化。
3. camera 写清景别、机位和运镜，避免相邻镜头无理由跳轴。
4. 不得臆造剧本没有的剧情、对白或心理活动。

如果主体资产中同一人物存在“原名-少儿”“原名-少年”“原名-青年”等阶段版本，必须根据该镜头所属集数和剧本中的年龄阶段选择唯一正确的版本，并在 visualPrompt 中逐字写出该主体资产的完整名称；禁止同时引用同一人物的其他阶段版本。`,
      JSON.stringify({
        style,
        subjects,
        episodes: episodes.map(({ id, episodeNumber }) => ({ id, episodeNumber })),
        formattedScreenplay: formattedText,
      }),
      { timeoutMs: 300000, maxTokens: SCRIPT_GENERATION_OUTPUT_TOKEN_BUDGET },
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
