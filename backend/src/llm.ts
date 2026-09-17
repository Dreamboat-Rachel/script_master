import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripSubjectVisualStyle } from "./subject-prompt.js";
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

function followsEpisodeScreenplayFormat(value: string) {
  const episodeHeadings = [...value.matchAll(/^第\s*\d+\s*集\s*$/gm)];
  if (!episodeHeadings.length) return false;
  return episodeHeadings.every((heading, index) => {
    const start = heading.index ?? 0;
    const end = episodeHeadings[index + 1]?.index ?? value.length;
    const episode = value.slice(start, end);
    return /^\s*\d+\s*-\s*\d+\s+.+\s+(?:日|夜|晨|昏)\s+(?:内|外)\s*$/m.test(episode)
      && /^【本集完】\s*$/m.test(episode)
      && /^——钩子：.+——\s*$/m.test(episode);
  });
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

function recommendedShotDuration(action: string, dialogue: string, camera: string, requested: number) {
  const actionLength = Array.from(action.replace(/[\s，,。；;：:！？!?、]/g, "")).length;
  const spokenText = dialogue.split(/\r?\n/).map((line) => line.replace(/^[^：:\n]{1,30}[：:]/, "")).join("");
  const dialogueLength = Array.from(spokenText.replace(/[\s，,。；;：:！？!?、（）()]/g, "")).length;
  const actionSeconds = actionLength <= 18 ? 3 : actionLength <= 38 ? 4 : actionLength <= 70 ? 5 : actionLength <= 110 ? 7 : 9;
  const dialogueSeconds = dialogueLength === 0 ? 0 : dialogueLength <= 10 ? 4 : dialogueLength <= 22 ? 6 : dialogueLength <= 36 ? 8 : dialogueLength <= 52 ? 10 : 12;
  const establishingSeconds = /(全景|远景|航拍|建立)/.test(camera) ? 5 : 0;
  const contentEstimate = Math.max(actionSeconds, dialogueSeconds, establishingSeconds);
  const requestedDuration = Math.min(12, Math.max(3, Math.round(requested)));
  return requestedDuration === 6 ? contentEstimate : Math.min(12, Math.max(3, Math.round((contentEstimate + requestedDuration) / 2)));
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function screenplayLocations(value: string) {
  const locations = new Set<string>();
  const heading = /(?:^|\n)\s*(?:第\s*\d+\s*集\s*)?\d+\s*-\s*\d+\s+(.{1,80}?)\s+(?:日|夜|晨|昏|清晨|上午|中午|下午|傍晚|深夜)\s+(?:内|外)(?=\s|$)/g;
  for (const match of value.matchAll(heading)) {
    const location = match[1]?.trim().replace(/[，,。；;：:]+$/, "");
    if (location) locations.add(location);
  }
  return Array.from(locations);
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

  async formatScript(originalText: string, customSystemPrompt?: string) {
    const builtInSystemPrompt = `你是资深中文短剧剧本编辑。请把用户提供的原始剧本整理成可以直接拍摄、并可继续交给分镜模型读取的标准短剧格式。

输出正文必须严格使用以下结构，尖括号只是字段说明，不得出现在结果中：
第1集
1-1 <地点> <日/夜/晨/昏> <内/外>
<动作，一句话一行>
<角色名>：<对白，一句一行>
【本集完】
——钩子：<只根据本集已有冲突或悬念提炼的一句话>——

第2集
2-1 <地点> <日/夜/晨/昏> <内/外>
……
【本集完】
——钩子：<只根据本集已有冲突或悬念提炼的一句话>——

排版与内容规则：
1. 每集必须单独以“第N集”开头；每个场景标题必须独占一行，严格写成“集号-场号 地点 时间 内/外”，例如“1-1 咖啡馆 日 内”。同一集有多个场景时依次写成 1-2、1-3；下一集从 2-1 重新编号。
2. 动作必须具体、可拍摄，一句话一个动作，一句一换行，避免一个动作段超过两行。
3. 对白严格写成“角色名：对白”，使用短句，一句一换行；动作和对白之间不要添加 Markdown 列表符号。
4. 每集结尾必须依次写“【本集完】”和“——钩子：……——”。钩子只能提炼原文已经存在的未决冲突、信息差或下一步悬念，不得新增剧情。
5. 按原文剧情顺序划分集与场，单集以 1 至 2 分钟的可拍摄内容量为目标。篇幅过长时在自然转折处分成下一集，篇幅不足时不得扩写凑时长。
6. 必须保留原文中的全部剧情事实、人物、动作、对白、时间、地点、数字、专有名词和关键细节；可以拆句、换行、添加集场编号并调整为标准剧本表达，但不得删减关键剧情、改变事件顺序、篡改人物关系或臆造新情节。
7. 原文未明确时间或内外景时，结合场景事实做最保守判断；无法判断时分别写“日”和“内”，不得为此补写剧情。
8. 不要输出“剧本格式整理”“说明”“原文备注”“排版要点”等附加标题，不要使用 Markdown 标题、粗体、表格或代码围栏。formattedText 中只能出现格式化后的完整剧本正文。
9. 只输出 JSON，格式必须为 {"formattedText":"完整格式化剧本","qualityReport":"简短说明"}。不要在 formattedText 之外重复原文。`;
    const customPrompt = customSystemPrompt?.trim();
    const systemPrompt = customPrompt
      ? `${customPrompt}

输出协议（仅用于系统读取，不改变上面的格式化要求）：
只输出 JSON，不要 Markdown 代码围栏。格式必须为 {"formattedText":"完整格式化剧本","qualityReport":"简短说明"}。formattedText 必须包含完整结果，不要在其他字段中重复用户原文。`
      : builtInSystemPrompt;
    const result = await this.complete(
      systemPrompt,
      JSON.stringify({ task: customPrompt ? "format_screenplay_with_custom_instructions" : "format_screenplay_without_loss", sourceText: originalText }),
      { timeoutMs: 300000, maxTokens: SCRIPT_GENERATION_OUTPUT_TOKEN_BUDGET },
    );
    const formatted = text(result.formattedText);
    if (!formatted) throw new Error("模型没有返回格式化剧本内容，请重试");
    if (!customPrompt && !followsEpisodeScreenplayFormat(formatted)) throw new Error("格式化结果未遵循标准短剧排版，请重试");
    return { formattedText: formatted, qualityReport: text(result.qualityReport, "已完成标准短剧格式化") };
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

  async extractSubjects(formattedText: string, existingSubjects: Subject[] = []): Promise<Array<Omit<Subject, "id" | "projectId" | "imageUrl" | "createdAt" | "updatedAt">>> {
    const result = await this.complete(
      `你是影视美术与资产设定师。请从剧本中提取所有会影响画面一致性的主体，包含主要角色、反复出现的地点和关键道具。不要遗漏只出现一次但对剧情重要的主体。
输出 JSON: {"subjects":[{"name":"","stage":"","role":"character|location|prop","description":"","visualPrompt":""}]}。

【提取顺序，必须逐项完成】
1. 角色：扫描人物表、对白署名、动作中的人物名称，提取本段实际出现或明确影响画面的角色。
2. 场景：逐个扫描“集-场 地点 时间 内/外”格式的场景标题。每一个不同地点至少输出一个 role=location 主体；即使场景只出现一次也不能遗漏。
3. 道具：再次扫描动作与对白，提取被拿取、递交、查看、使用、损坏、隐藏，或推动剧情的可见物品，输出 role=prop。普通不可辨识背景杂物不提取。
4. 返回前分别统计 character、location、prop。只要原文存在场景标题，location 绝不能为 0；只要存在明确被操作或影响剧情的物品，prop 绝不能为 0。

【项目主体库复用规则】
输入中的 existingSubjectRegistry 是本项目已经锁定的主体库。当前剧本出现同一角色、同一阶段、同一地点或同一道具时，必须逐字复用主体库中的 name，不得创建近义名称、简称或重新命名，也不得重新设计其稳定外观。只有剧本明确出现新的年龄阶段、造型阶段、地点版本或道具版本时才能新增主体。

【纯主体提示词规则】
description 和 visualPrompt 只能描述主体本身的稳定外观、结构、材质、空间布局和识别特征。不得写入电影写实、动漫、吉卜力、赛博朋克、国风、3D、摄影、渲染媒介、色彩风格等任何视觉风格；视觉风格会在主体卡片点击生图时单独选择并组合。

【人物阶段拆分规则，必须遵守】
1. 同一人物只要在剧本中出现两个或以上明确的年龄、人生阶段或造型阶段，必须拆成多个独立的 character 主体，绝对不能合并成一个主体，也不能把多个阶段写在同一个 description 或 visualPrompt 中。
2. 每个阶段的 name 必须是“原人物名-阶段”，例如：韩立-少儿、韩立-少年、韩立-青年。stage 字段只填写一个简短阶段名，例如“少儿”“少年”“青年”；如果 name 已经带阶段后缀，不要重复添加。
3. 阶段命名参考：儿童、幼年、年幼或少年早期写“少儿”；约十四至十八岁、十五岁写“少年”；成年、二十岁以上、二十五岁写“青年”；更高年龄按事实写“中年”或“老年”。如果前一阶段只写“少年”、后一阶段明确写“十五岁”，前者按更年幼阶段命名为“少儿”，后者命名为“少年”。例如同一人物第一集为少年、第二集十五岁、第三集二十五岁时，必须输出“原名-少儿”“原名-少年”“原名-青年”三个主体。不要因为人物同名就合并不同阶段。
4. 每个阶段只描述该阶段的年龄、身形、面容、发型、肤色、服装、固定道具和其他稳定识别特征。若某特征未设定，写“未设定”。不得把其他年龄阶段的信息带进来。
5. 地点和道具也要按视觉上确实不同的版本拆分；仅仅在不同场次出现、但外观没有变化的主体不要重复创建。

visualPrompt 是“主体设定提示词”，只用于生成该主体的完整、独立设定图，不能把一段剧情改写成某个镜头。所有主体都必须只根据剧本事实，未知信息明确写“未设定”，不得臆造年龄、肤色或品牌。除下方规定的设定图排版外，禁止写具体镜头、景别、机位、运镜、正在发生的动作、对白、剧情瞬间、其他阶段和其他主体。

主体类型的额外规则，必须严格执行：
1. role=location（场景）：生成完整的、无人占用的空场景设定。画布必须水平分成上、中、下三个等高区域，依次展示同一场景的清晨、日间、夜晚三个时间段；三个区域必须使用完全相同的空间结构、视点、比例、门窗、出入口、固定家具、设备和物件位置，只允许自然光线与时间氛围变化。必须描述可拍摄且合理的空间布局、房间边界、墙面/地面/天花板、主要动线、尺度关系和固定光源安装位置。禁止出现人物、动物、手、人体、群演、正在发生的动作、对白、剧情道具特写或把多个房间不可能地拼在一起；除非剧本明确要求，不要加入与场景无关的装饰。
2. role=prop（道具）：生成完整单体物品的四视图设定图，同一画布从左到右依次展示正面、左侧、背面、右侧；四个视图必须等高等比例、材质颜色结构完全一致，并完整呈现物品外形、比例、材质、颜色、纹理、接口/开合部件和可识别细节。禁止出现人物、手、人体、场景、桌面、正在使用它的动作或其他道具；不要只描述屏幕、局部或一个使用瞬间。
3. role=character（角色）：生成同一人物的四视图设定图，同一画布从左到右依次展示正面、左侧、背面、右侧；四个视图必须等高等比例、全身完整，脸型、发型、体态、服装、配饰和固定识别特征完全一致。只描述该阶段单一人物，不要混入其他年龄阶段、场景或动作。
返回前自检：场景 visualPrompt 中不得出现人物或“某人正在……”等动态内容；道具 visualPrompt 中不得出现人物、手或使用场景；房屋/室内场景必须能画出完整平面关系而不是杂乱物件堆叠；如果一个人物的 description 或 visualPrompt 中出现了两个年龄/阶段，必须拆成多个对象；每个阶段对象的 name 必须唯一。`,
      JSON.stringify({
        existingSubjectRegistry: existingSubjects.slice(0, 200).map((subject) => ({
          name: subject.name,
          role: subject.role,
          description: subject.description,
          visualPrompt: subject.visualPrompt,
        })),
        formattedScreenplay: formattedText,
      }),
      {
        timeoutMs: 300000,
        inputTokenBudget: SCRIPT_GENERATION_INPUT_TOKEN_BUDGET,
        maxTokens: SCRIPT_GENERATION_OUTPUT_TOKEN_BUDGET,
      },
    );
    const subjects = Array.isArray(result.subjects) ? result.subjects : [];
    if (!subjects.length) throw new Error("DeepSeek 没有返回主体结果");
    const seen = new Set<string>();
    const normalizedSubjects = subjects.flatMap((item) => {
      const row = item as JsonObject;
      const roleValue = text(row.role, "character").trim().toLocaleLowerCase();
      const role: Subject["role"] = roleValue === "location" || roleValue === "scene" || roleValue === "setting" || roleValue.includes("场景") || roleValue.includes("地点") || roleValue.includes("环境")
        ? "location"
        : roleValue === "prop" || roleValue === "object" || roleValue === "item" || roleValue.includes("道具") || roleValue.includes("物品") || roleValue.includes("物件")
          ? "prop"
          : "character";
      const rawName = text(row.name, "未命名主体");
      const stage = role === "character" ? text(row.stage) : "";
      const stageSeparator = stage ? ["-", "－", "—", "·", "•", "丨", "|", "｜"].find((separator) => rawName.endsWith(`${separator}${stage}`)) : undefined;
      const name = stage ? stageSeparator ? `${rawName.slice(0, -(stage.length + stageSeparator.length))}-${stage}` : `${rawName}-${stage}` : rawName;
      const key = `${role}:${name}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const description = stripSubjectVisualStyle(text(row.description, "未设定"));
      const generatedPrompt = stripSubjectVisualStyle(text(row.visualPrompt, name));
      const promptGuard = role === "location"
        ? "构图规范：画布水平分成上、中、下三个等高区域，依次展示同一空场景的清晨、日间、夜晚；三个区域保持完全相同的空间结构、视点、比例、门窗、出入口、固定家具设备、相对位置和动线，只改变符合时间段的自然光线；无人、无动物、无剧情动作、无文字水印，禁止房间拼接、物件漂浮、穿模、悬空家具和无法到达的出入口。"
        : role === "prop"
          ? "构图规范：完整单体道具四视图，同一画布从左到右依次展示正面、左侧、背面、右侧；四个视图等高等比例，外形、材质、颜色、纹理、接口和开合结构完全一致；不出现人物、手、人体、桌面、房间、其他道具、文字或水印。"
          : "构图规范：同一阶段、同一人物四视图，同一画布从左到右依次展示正面、左侧、背面、右侧；四个视图等高等比例、全身完整，脸型、发型、体态、服装、配饰和识别特征完全一致；不出现额外人物、其他年龄阶段、动作场景、文字或水印。";
      return [{ name, role, description, visualPrompt: `${generatedPrompt}\n${promptGuard}` }];
    });
    const knownLocations = new Set(normalizedSubjects.filter((subject) => subject.role === "location").map((subject) => subject.name.replace(/\s+/g, "").toLocaleLowerCase()));
    for (const location of screenplayLocations(formattedText)) {
      const key = location.replace(/\s+/g, "").toLocaleLowerCase();
      if (knownLocations.has(key)) continue;
      knownLocations.add(key);
      normalizedSubjects.push({
        name: location,
        role: "location",
        description: `剧本场景：${location}。空间细节未明确的部分保持未设定，后续沿用同一空间布局。`,
        visualPrompt: `${location}，完整空场景设定图，展示空间边界、门窗、出入口、固定家具、主要动线、相对位置和固定光源；无人、无动物、无剧情动作、无文字水印。\n构图规范：画布水平分成上、中、下三个等高区域，依次展示同一空场景的清晨、日间、夜晚；三个区域保持完全相同的空间结构、视点、比例、门窗、出入口、固定家具设备、相对位置和动线，只改变符合时间段的自然光线。`,
      });
    }
    return normalizedSubjects;
  }

  async extractShots(formattedText: string, episodes: Array<{ id: string; episodeNumber: number }>, subjects: Subject[], style: string, customSystemPrompt?: string, targetDurationSeconds = 60): Promise<Array<Omit<Shot, "id" | "projectId" | "createdAt" | "updatedAt">>> {
    const episodeDuration = Math.min(720, Math.max(15, Math.round(targetDurationSeconds)));
    const recommendedShotCount = Math.min(15, Math.max(8, Math.round(episodeDuration / 6)));
    const preferredMinShotCount = 8;
    const preferredMaxShotCount = 15;
    const maxShotCount = 20;
    const shotCountProtocol = `镜头数量与时长规则：
1. 每集目标总时长约 ${episodeDuration} 秒，建议 ${recommendedShotCount} 个镜头；常规应控制在 ${preferredMinShotCount}-${preferredMaxShotCount} 个，剧情确实复杂时可以增加，但绝对不得超过 ${maxShotCount} 个。原文内容很短且无法支撑 8 个镜头时可以少于 8 个，禁止扩写剧情凑数量。
2. 单镜头推荐 3-12 秒，各镜头 durationSeconds 总和应尽量接近 ${episodeDuration} 秒。
   - 3-4 秒：短反应、简单动作、无对白或极短对白。
   - 5-7 秒：一般动作、普通对话和常规建立镜头。
   - 8-12 秒：较长对白、复杂调度或需要充分展示环境的镜头。
   不得为了省事把所有镜头统一写成 6 秒，必须逐镜头估算。
3. 不要把每句话、每个表情或每个连续动作各拆成一个镜头。相同地点、相同时间且机位可连续表达的短对白与动作应合并到同一个镜头；仅在换场、叙事重点变化或确有剪辑必要时切镜。
4. 在不遗漏关键情节与关键对白的前提下，以精炼、可生成、可剪辑为优先。`;
    const builtInSystemPrompt = `你是影视分镜导演。请基于剧本、分集和主体资产生成可直接用于视频生成的镜头清单。必须覆盖原文关键剧情和关键对白；每个镜头表达一个完整、可连续拍摄的视觉段落。输出 JSON: {"shots":[{"episodeNumber":1,"shotOrder":1,"title":"","location":"","action":"","dialogue":"","visualPrompt":"","camera":"","durationSeconds":6,"status":"ready"}]}。shotOrder 在每集内从 1 连续编号。

${shotCountProtocol}

对白规则：
1. dialogue 只能填写原文中人物实际说出的对白或原文明确标注的内心 OS，保留人物名和原文措辞；格式使用“人物名：原文台词”或“人物名（OS）：原文内容”。
2. 禁止把场景说明、动作、背景介绍、人物心理推测改写成旁白、解说、画外音或新增台词。原文没有对白或 OS 时，dialogue 必须为空字符串。
3. 不要为了填满镜头时长增加台词。较长原文对白应按自然语义拆到连续镜头中，每个镜头的台词量必须能以自然或舒缓语速在 durationSeconds 内说完。

连续性规则（这是分镜提示词的硬约束，不是可选建议）：
1. 必须按每集 shotOrder 从前到后规划镜头。除每集第一个镜头外，每个 visualPrompt 都必须明确写出“承接上一镜头结束状态”：上一镜头最后一帧的人物姿势、位置、视线、服装、道具位置、空间方位、光线、色调、运动方向和动作进度；然后写“本镜头首帧”：从这些状态原地开始的当前构图；最后写“本镜头发展”：只在连续时间中完成当前动作和结束状态。不得把后续镜头写成重新入场或独立重启。
2. visualPrompt 要包含主体、环境、光线、情绪、本镜头开场状态和结束状态；相邻镜头的“结束状态 → 开场状态”必须能直接衔接。每个镜头都要有明确的结束状态，供下一个镜头继承。
3. 同一场景的相邻镜头必须保持人物外观与服装、道具、空间方位、光线、天气、色调和运动方向一致，除非原文明确发生变化。
4. camera 写清景别、机位和运镜，避免相邻镜头无理由跳轴；若必须换景别或机位，要把变化放在剪辑点并保持人物/道具/视线/光线的空间连续，不要在镜头内部旋转、变形或无理由转景。
5. 不得臆造剧本没有的剧情、对白或心理活动。
6. 相邻镜头更换景别或机位时，默认在剪辑点直接切镜；每个镜头的第一帧就是本镜头目标构图，但该第一帧必须继承上一镜头结束时的主体状态，禁止把从上一构图移动、旋转或变形成当前构图的过程写进 visualPrompt。
7. 只有同一场景、同一机位下的连续动作才可直接使用上一镜头尾帧；如果更换时间或地点，剪辑点发生在视频开始前，第一帧直接进入新场景，但仍继承可见人物外观、服装、道具、色彩和叙事动作进度，不要默认添加淡入淡出、叠化、甩镜或遮挡转场。
8. 以第一镜头建立整部影片的基础色彩方案。后续镜头默认继承同一色温、白平衡、明暗关系、曝光倾向、饱和度和统一调色风格；即使切到普通新地点，也不能无理由在暖色调与冷色调之间跳变。
9. 只有原文明确发生时间、天气变化，进入本身具有特殊光色的地点，或明确出现闪回、梦境等视觉动机时，才允许改变基础色彩方案；变化后的连续镜头必须稳定继承新的色彩基线，直至原文再次明确变化。
10. 每个 visualPrompt 都必须重复写明该镜头所继承的色温、主光方向、曝光或明暗关系、饱和度以及统一调色关键词。同一连续场景必须复用一致措辞，禁止在相邻镜头中无依据地交替使用“暖色调”“冷色调”等冲突描述。
11. 生成前自检每集相邻镜头：如果当前镜头开场状态无法从上一镜头结束状态自然推出，必须先修改当前镜头的 action、camera 和 visualPrompt，再输出 JSON；不能仅依赖剪辑或后期弥补不连续。

主体资产引用规则：
1. 每个镜头必须从 subjects 中识别该镜头实际可见的角色、场景和道具，并在 visualPrompt 中逐字写出对应主体资产的完整名称，随后沿用该主体的 description 和 visualPrompt 中的稳定特征。
2. subjects 中已有 imageUrl 的主体表示已有锁定参考图；不得重新设计其外观、材质、服装、空间布局或识别特征。
3. 不得引用当前镜头中没有出现的主体，也不得虚构 subjects 之外的新主体来替代已有主体。
4. 如果同一人物存在“原名-少儿”“原名-少年”“原名-青年”等阶段版本，必须根据该镜头所属集数和剧本中的年龄阶段选择唯一正确的版本，并在 visualPrompt 中逐字写出该主体资产的完整名称；禁止同时引用同一人物的其他阶段版本。`;
    const customPrompt = customSystemPrompt?.trim();
    const systemPrompt = customPrompt
      ? `${customPrompt}

系统输出与资产协议：
1. 只输出 JSON，不要输出 Markdown 代码围栏。格式必须为 {"shots":[{"episodeNumber":1,"shotOrder":1,"title":"","location":"","action":"","dialogue":"","visualPrompt":"","camera":"","durationSeconds":6,"status":"ready"}]}。
2. shotOrder 在每集内必须从 1 连续编号，durationSeconds 必须为 3 至 12 秒。
3. 必须以 formattedScreenplay 为剧情依据。每个镜头必须识别实际可见的 subjects，并在 visualPrompt 中逐字引用对应主体资产的完整名称及其稳定特征；已有 imageUrl 的主体不得重新设计。
4. dialogue 只能使用原文真实对白或明确的 OS，不得新增台词、旁白或剧情。

${shotCountProtocol}`
      : builtInSystemPrompt;
    const result = await this.complete(
      systemPrompt,
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
    const normalized = shots.map((item, index) => {
      const row = item as JsonObject;
      const requestedEpisode = Math.round(number(row.episodeNumber, 1));
      const episodeNumber = episodeIds.has(requestedEpisode) ? requestedEpisode : episodes[Math.min(index, episodes.length - 1)].episodeNumber;
      const shotOrder = (nextOrder.get(episodeNumber) ?? 0) + 1;
      nextOrder.set(episodeNumber, shotOrder);
      const action = text(row.action, "未设定");
      const dialogue = text(row.dialogue);
      const camera = text(row.camera, "中景");
      return { episodeId: episodeIds.get(episodeNumber)!, episodeNumber, shotOrder, title: text(row.title, `镜头 ${index + 1}`), location: text(row.location, "未设定"), action, dialogue, visualPrompt: text(row.visualPrompt, `${style}，${action}`), camera, durationSeconds: recommendedShotDuration(action, dialogue, camera, number(row.durationSeconds, 6)), status: "ready" as const };
    });
    for (const episode of episodes) {
      const episodeShotCount = normalized.filter((shot) => shot.episodeNumber === episode.episodeNumber).length;
      if (episodeShotCount > maxShotCount) {
        throw new Error(`第 ${episode.episodeNumber} 集生成了 ${episodeShotCount} 个镜头，超过本集 ${episodeDuration} 秒时长的上限 ${maxShotCount} 个，请重新生成`);
      }
    }
    const compact = (value: string) => value.toLocaleLowerCase().replace(/[\s·•丨|｜_，,。；;：:、/\\()（）【】\[\]《》"']/g, "");
    const locationSubjects = subjects.filter((subject) => subject.role === "location");
    const shotsWithSubjectReferences = normalized.map((shot) => {
      const shotText = `${shot.location}\n${shot.action}\n${shot.dialogue}\n${shot.visualPrompt}`;
      const compactShotText = compact(shotText);
      const compactLocation = compact(shot.location);
      const referenced = subjects.filter((subject) => {
        const subjectName = subject.name.trim();
        const compactName = compact(subjectName);
        if (!subjectName || !compactName) return false;
        if (shotText.includes(subjectName) || compactShotText.includes(compactName)) return true;
        return subject.role === "location" && (compactLocation.includes(compactName) || compactName.includes(compactLocation));
      });
      if (!referenced.some((subject) => subject.role === "location") && locationSubjects.length === 1) referenced.unshift(locationSubjects[0]);
      if (!referenced.length && subjects.length === 1) referenced.push(subjects[0]);
      const uniqueReferences = Array.from(new Map(referenced.map((subject) => [subject.id, subject])).values());
      const referenceLine = uniqueReferences.length ? `本镜头引用主体资产：${uniqueReferences.map((subject) => `「${subject.name}」`).join("、")}。` : "";
      const styleLine = `视觉风格：${style}。`;
      return { ...shot, visualPrompt: [styleLine, referenceLine, shot.visualPrompt].filter(Boolean).join("\n") };
    });
    return shotsWithSubjectReferences.map((shot, index) => {
      const previousShot = shotsWithSubjectReferences
        .slice(0, index)
        .filter((candidate) => candidate.episodeNumber === shot.episodeNumber)
        .at(-1);
      const previousPromptTail = previousShot?.visualPrompt.trim().slice(-1200);
      const continuityAnchor = previousShot
        ? [
          "连续性锚点（必须执行，不是独立镜头）：",
          `上一镜头《${previousShot.title}》结束于：${previousShot.location}；结束动作：${previousShot.action}；摄影机：${previousShot.camera}。`,
          previousPromptTail ? `上一镜头画面提示词的末尾状态：${previousPromptTail}` : "上一镜头画面提示词未提供末尾状态。",
          "本镜头第 0 秒必须从上述结束状态自然开始，继承人物/道具位置、姿势、视线、空间方位、光线、色温、曝光、饱和度和运动方向；先保持状态，再逐步完成当前动作，最后写清本镜头结束状态供下一个镜头继续。禁止重新入场、重置空间、无理由转景或在片内制作转场。",
        ].join("\n")
        : "连续性锚点（本集首镜头）：建立人物、道具、空间方位、摄影机、光线、色温、曝光、饱和度和运动方向的基线，并写清本镜头结束状态，供下一镜头从此处继续。";
      return { ...shot, visualPrompt: `${continuityAnchor}\n当前镜头画面：${shot.visualPrompt}` };
    });
  }
}
