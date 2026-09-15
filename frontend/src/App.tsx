import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowLeftRight, ArrowRight, AudioLines, Check, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, Combine, Copy, Download, FileAudio, FileText, Film, FolderOpen, Headphones, Layers3,
  Eye, EyeOff, ImagePlus, ListChecks, LoaderCircle, LockKeyhole, LogOut, Mail, Menu, Mic2, Moon, MoreHorizontal, Pencil, Play, Plus, ScanSearch, Settings2, Sparkles,
  RefreshCw, Search, ListFilter, Sun, Trash2, Upload, UserRound, UsersRound, WandSparkles, X,
} from "lucide-react";
import { api } from "./api";
import type { AssetLibraryData, AssetLibraryItem, AssetLibraryKind, CharacterImageResult, DashboardData, Episode, HomeToolType, ImageAspectRatio, ImageResolution, ImageSettings, LlmSettings, PipelineData, Project, RenderJob, Shot, ShotContinuityPreview, SpeechEmotion, SpeechLanguageBoost, StudioAssetType, StudioVideoResult, StudioVideoType, Subject, SubjectImageInput, TextToSpeechResult, VideoAudioMode, VideoContinuityMode, VideoMerge, VideoSettings, VideoSpeechRate, VoiceCloneResult } from "./types";

type Stage = "setup" | "format" | "episodes" | "subjects" | "shots" | "render";
type WorkingAction = "setup" | "generate" | "format" | "episodes" | "subjects" | "shots" | "render" | "delete" | "deleteSubject";
const stages: Array<{ id: Stage; label: string; description: string; icon: typeof FileText }> = [
  { id: "setup", label: "项目设定", description: "确定项目规格", icon: Settings2 },
  { id: "format", label: "剧本格式化", description: "整理标准剧本", icon: WandSparkles },
  { id: "episodes", label: "剧本解析", description: "分集与情节结构", icon: Layers3 },
  { id: "subjects", label: "主体生成", description: "角色 · 场景 · 道具", icon: UsersRound },
  { id: "shots", label: "故事板", description: "生成分镜内容", icon: ScanSearch },
  { id: "render", label: "视频合成", description: "选择并合并镜头", icon: Combine },
];
const sampleScript = `午夜车站
类型：悬疑短片

场次一：外景，旧车站，夜
雨停了。林默站在空荡的月台，检查最后一盏信号灯。

林默：今晚不会再有人来了。

场次二：内景，检票亭，夜
一封没有寄件人的信从售票窗口滑进来，落款日期是二十年以后。

林默打开信，车站深处传来列车启动的声音。`;
const MAX_SCRIPT_LENGTH = 200000;
const MIN_LOGLINE_LENGTH = 50;
const LOGIN_SESSION_KEY = "script-master-local-session-v1";
const USER_PROFILE_KEY = "script-master-local-profile-v1";
const THEME_STORAGE_KEY = "script-master-theme-v1";
const fallbackLoginCover = "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1800&q=88";
const readSavedSession = () => window.localStorage.getItem(LOGIN_SESSION_KEY) ?? window.sessionStorage.getItem(LOGIN_SESSION_KEY) ?? "";
type ThemeMode = "dark" | "light";
const readSavedTheme = (): ThemeMode => {
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
};
type LocalUserProfile = { displayName: string; email: string; avatarDataUrl: string };
type AccountDialogKind = "profile" | "avatar" | "email" | "logout";
const emptyUserProfile = (): LocalUserProfile => ({ displayName: "", email: "", avatarDataUrl: "" });
const readSavedUserProfile = (account: string): LocalUserProfile => {
  if (!account) return emptyUserProfile();
  try {
    const saved = JSON.parse(window.localStorage.getItem(`${USER_PROFILE_KEY}:${account}`) ?? "null") as Partial<LocalUserProfile> | null;
    return { displayName: saved?.displayName ?? "", email: saved?.email ?? "", avatarDataUrl: saved?.avatarDataUrl ?? "" };
  } catch {
    return emptyUserProfile();
  }
};
const imageProviderDefaults: Record<ImageSettings["provider"], string> = {
  volcengine: "https://ark.cn-beijing.volces.com/api/v3",
  aliyun: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  openai: "https://api.openai.com/v1",
  custom: "http://localhost:8000/v1",
};
const imageModelOptions = [
  "doubao-seedream-5-0-pro-260628",
  "doubao-seedream-4-0-250828",
];
const videoModelOptions: VideoSettings["model"][] = [
  "doubao-seedance-2-0-mini-260615",
  "doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-fast-260128",
];
const videoModelLabels: Record<VideoSettings["model"], string> = {
  "doubao-seedance-2-0-mini-260615": "Seedance 2.0 Mini",
  "doubao-seedance-2-0-260128": "Seedance 2.0",
  "doubao-seedance-2-0-fast-260128": "Seedance 2.0 Fast",
};
type ImageSettingsDraft = Pick<ImageSettings, "provider" | "model" | "apiBase"> & { apiKey: string };
type VideoSettingsDraft = Pick<VideoSettings, "provider" | "model" | "apiBase"> & { apiKey: string };
type SubjectImageDraft = SubjectImageInput & { referenceName: string };
const imageRatioOptions: Array<{ value: ImageAspectRatio; label: string }> = [
  { value: "1:1", label: "1:1 · 方形" }, { value: "16:9", label: "16:9 · 横屏" }, { value: "9:16", label: "9:16 · 竖屏" },
  { value: "3:2", label: "3:2 · 横向" }, { value: "2:3", label: "2:3 · 竖向" }, { value: "4:3", label: "4:3 · 横向" }, { value: "3:4", label: "3:4 · 竖向" },
];
const imageSizeLabels: Record<ImageResolution, Record<ImageAspectRatio, string>> = {
  "2K": { "1:1": "2048 x 2048", "16:9": "2560 x 1440", "9:16": "1440 x 2560", "3:2": "2160 x 1440", "2:3": "1440 x 2160", "4:3": "2048 x 1536", "3:4": "1536 x 2048" },
  "4K": { "1:1": "4096 x 4096", "16:9": "4096 x 2304", "9:16": "2304 x 4096", "3:2": "3840 x 2560", "2:3": "2560 x 3840", "4:3": "4096 x 3072", "3:4": "3072 x 4096" },
};
const emptyPipeline = (): PipelineData => ({ project: {} as Project, document: null, episodes: [], subjects: [], shots: [] });
const formatDuration = (seconds: number) => `${Math.floor(seconds / 60) ? `${Math.floor(seconds / 60)}m ` : ""}${String(seconds % 60).padStart(2, "0")}s`;
const targetDurationOptions = [15, 30, 60, 90, 120, 180, 300, 600, 720];
const formatEpisodeLabel = (episodeNumber: number) => {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (episodeNumber === 100) return "第一百集";
  if (episodeNumber < 10) return `第${digits[episodeNumber]}集`;
  const tens = Math.floor(episodeNumber / 10);
  const ones = episodeNumber % 10;
  return `第${tens > 1 ? digits[tens] : ""}十${ones ? digits[ones] : ""}集`;
};
const getProjectTitle = (text: string) => text.split("\n").map((line) => line.trim()).find(Boolean)?.slice(0, 40) || "未命名剧本";
const subjectsMentionedInShot = (shot: Shot, subjects: Subject[]) => {
  const content = [shot.title, shot.location, shot.action, shot.dialogue, shot.visualPrompt].join(" ");
  return subjects.filter((subject) => subject.name.trim() && content.includes(subject.name.trim()));
};
const dialogueWithoutNarration = (dialogue: string) => dialogue
  .split(/\r?\n/)
  .filter((line) => !/^\s*(旁白|解说|画外音|narrator)\s*[：:]/i.test(line))
  .join("\n")
  .replace(/\s*(旁白|解说|画外音|narrator)\s*[：:][\s\S]*$/i, "")
  .trim();
const shotVideoPrompt = (shot: Shot, previousShot?: Shot) => [
  ...(previousShot ? [
    "上一镜头画面（当前镜头必须从此处自然延伸）：",
    `上一镜头：${previousShot.title}`,
    `上一场景：${previousShot.location}`,
    `上一镜头结束动作：${previousShot.action}`,
    `上一镜头摄影：${previousShot.camera}`,
    `上一镜头画面提示词：${previousShot.visualPrompt}`,
    "承接要求：继承上一镜头末尾的人物姿势、位置、视线、服装、道具、光线、空间方位和运动方向；不要重新入场，不要重复已经完成的动作，不要在视频内部制作转场。",
    "",
  ] : []),
  "当前镜头目标（从上述结束状态继续）：",
  `当前镜头：${shot.title}`,
  `当前场景：${shot.location}`,
  `当前动作：${shot.action}`,
  `当前摄影：${shot.camera}`,
  `当前画面：${shot.visualPrompt}`,
  dialogueWithoutNarration(shot.dialogue) ? `人物对白 / 内心 OS（须逐字呈现）：${dialogueWithoutNarration(shot.dialogue)}` : "人物对白 / 内心 OS：无（禁止添加旁白或解说）",
].join("\n");
const submittedVideoPrompt = (generationPrompt: string | null) => {
  if (!generationPrompt?.trim()) return null;
  const matchers = [
    /(?:^|\r?\n\r?\n)用户确认的视频提示词（除连续性首帧约束外必须执行）：\r?\n([\s\S]*?)(?=\r?\n\r?\n衔接方式：)/,
    /(?:^|\r?\n\r?\n)当前镜头目标：\r?\n([\s\S]*?)(?=\r?\n\r?\n(?:声音要求：|允许说出的唯一文本|音乐要求：|画面中不要生成))/,
  ];
  for (const matcher of matchers) {
    const matched = generationPrompt.match(matcher)?.[1]?.trim();
    if (matched) return matched;
  }
  return generationPrompt.trim();
};

function App() {
  const [sessionUser, setSessionUser] = useState(readSavedSession);
  const [theme, setTheme] = useState<ThemeMode>(readSavedTheme);
  const [userProfile, setUserProfile] = useState<LocalUserProfile>(() => readSavedUserProfile(readSavedSession()));
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountDialog, setAccountDialog] = useState<AccountDialogKind | null>(null);
  const [helpVisible, setHelpVisible] = useState(false);
  const [homeSection, setHomeSection] = useState<"home" | "pipeline">("home");
  const [homeTool, setHomeTool] = useState<HomeToolType | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [renderJobs, setRenderJobs] = useState<RenderJob[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [homeVisible, setHomeVisible] = useState(true);
  const [pipeline, setPipeline] = useState<PipelineData>(emptyPipeline());
  const [stage, setStage] = useState<Stage>("setup");
  const [sourceScriptMode, setSourceScriptMode] = useState(false);
  const [setupDraft, setSetupDraft] = useState({ title: "", logline: "", genre: "悬疑", style: "电影写实", aspectRatio: "16:9", durationSeconds: 60, targetEpisodeCount: 3 });
  const [scriptText, setScriptText] = useState("");
  const [loading, setLoading] = useState(true);
  const [workingAction, setWorkingAction] = useState<WorkingAction | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [imageSettings, setImageSettings] = useState<ImageSettings | null>(null);
  const [videoSettings, setVideoSettings] = useState<VideoSettings | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [imageSettingsDraft, setImageSettingsDraft] = useState<ImageSettingsDraft>({ provider: "volcengine", apiKey: "", model: imageModelOptions[0], apiBase: imageProviderDefaults.volcengine });
  const [videoSettingsDraft, setVideoSettingsDraft] = useState<VideoSettingsDraft>({ provider: "volcengine", apiKey: "", model: videoModelOptions[0], apiBase: imageProviderDefaults.volcengine });
  const [generatingSubjectIds, setGeneratingSubjectIds] = useState<string[]>([]);
  const [subjectImagePreview, setSubjectImagePreview] = useState<Subject | null>(null);
  const generatingSubjectId = generatingSubjectIds;
  const [imageDialogSubject, setImageDialogSubject] = useState<Subject | null>(null);
  const [subjectImageDraft, setSubjectImageDraft] = useState<SubjectImageDraft>({ prompt: "", model: imageModelOptions[0], resolution: "2K", aspectRatio: "1:1", referenceName: "" });
  const [videoDialogShot, setVideoDialogShot] = useState<Shot | null>(null);
  const [videoDialogInitialPrompt, setVideoDialogInitialPrompt] = useState<string | null>(null);
  const [submittedRenderJobId, setSubmittedRenderJobId] = useState<string | null>(null);
  const [videoPreview, setVideoPreview] = useState<{ shot: Shot; url: string } | null>(null);
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
  const [existingScriptSetupOpen, setExistingScriptSetupOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteSubjectTarget, setDeleteSubjectTarget] = useState<Subject | null>(null);
  const [projectManagerVisible, setProjectManagerVisible] = useState(false);
  const [managerProjects, setManagerProjects] = useState<Project[]>([]);
  const [managerLoading, setManagerLoading] = useState(false);
  const [assetLibraryVisible, setAssetLibraryVisible] = useState(false);
  const [assetLibrary, setAssetLibrary] = useState<AssetLibraryData | null>(null);
  const [assetLibraryLoading, setAssetLibraryLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadProject = async (nextProject: Project, requestedStage?: Stage) => {
    setProject(nextProject);
    setHomeVisible(false);
    window.scrollTo(0, 0);
    setSetupDraft({ title: nextProject.title, logline: nextProject.logline, genre: nextProject.genre, style: nextProject.style, aspectRatio: nextProject.aspectRatio, durationSeconds: nextProject.durationSeconds, targetEpisodeCount: nextProject.targetEpisodeCount });
    try {
      const data = await api.pipeline(nextProject.id);
      setPipeline(data); setScriptText(data.document?.originalText ?? "");
      if (requestedStage) setStage(requestedStage);
      else if (data.shots.length) setStage("shots"); else if (data.subjects.length) setStage("subjects"); else if (data.episodes.length) setStage("episodes"); else if (data.document) setStage("format"); else setStage("setup");
    } catch (caught) { setToast(caught instanceof Error ? caught.message : "项目读取失败"); }
  };
  const refresh = async () => {
    try { const [data, jobs] = await Promise.all([api.dashboard(), api.jobs()]); setDashboard(data); setRenderJobs(jobs); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "无法连接后端服务"); } finally { setLoading(false); }
  };
  const refreshProjectManager = async () => {
    setManagerLoading(true);
    try { setManagerProjects(await api.projects()); }
    catch (caught) { setToast(caught instanceof Error ? caught.message : "项目列表读取失败"); }
    finally { setManagerLoading(false); }
  };
  const refreshAssetLibrary = async () => {
    setAssetLibraryLoading(true);
    try { setAssetLibrary(await api.assets()); }
    catch (caught) { setToast(caught instanceof Error ? caught.message : "资产库读取失败"); }
    finally { setAssetLibraryLoading(false); }
  };
  useEffect(() => { void refresh(); void api.videoSettings().then(setVideoSettings).catch(() => undefined); }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);
  const hasActiveRender = Boolean(project?.id && renderJobs.some((job) => job.projectId === project.id && (job.status === "queued" || job.status === "processing")));
  useEffect(() => {
    if (!hasActiveRender) return;
    const stream = new EventSource("/api/jobs/stream");
    stream.onmessage = (event) => {
      try { setRenderJobs(JSON.parse(event.data) as RenderJob[]); }
      catch { /* Ignore malformed status events and wait for the next update. */ }
    };
    return () => stream.close();
  }, [project?.id, hasActiveRender]);
  useEffect(() => {
    if (!submittedRenderJobId) return;
    const submittedJob = renderJobs.find((job) => job.id === submittedRenderJobId);
    if (submittedJob?.status === "failed") {
      setToast(`视频生成失败：${submittedJob.errorMessage || "视频平台未能创建任务"}`);
      setSubmittedRenderJobId(null);
    } else if (submittedJob?.status === "completed") {
      setSubmittedRenderJobId(null);
    }
  }, [renderJobs, submittedRenderJobId]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 3400); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const handlePreview = (event: Event) => setSubjectImagePreview((event as CustomEvent<Subject>).detail);
    window.addEventListener("subject-image-preview", handlePreview);
    return () => window.removeEventListener("subject-image-preview", handlePreview);
  }, []);
  useEffect(() => {
    if (!homeVisible) window.scrollTo({ top: 0, behavior: "auto" });
  }, [homeVisible, stage]);
  const currentIndex = stages.findIndex((item) => item.id === stage);
  const completion = useMemo(() => Math.round(([pipeline.document?.formatStatus === "formatted", pipeline.episodes.length > 0, pipeline.subjects.length > 0, pipeline.shots.length > 0].filter(Boolean).length / 4) * 100), [pipeline]);
  const working = workingAction !== null;
  const run = async <T,>(actionName: WorkingAction, action: () => Promise<T>, success: string | ((result: T) => string)) => { if (working) { setToast("当前操作正在处理中，请稍候"); return; } setWorkingAction(actionName); try { const result = await action(); setToast(typeof success === "function" ? success(result) : success); } catch (caught) { setToast(caught instanceof Error ? caught.message : "处理失败"); } finally { setWorkingAction(null); } };
  const projectInput = (draft: ProjectDraft) => ({ title: draft.title.trim(), logline: draft.logline.trim().slice(0, 5000), genre: draft.genre, style: draft.style, aspectRatio: draft.aspectRatio, durationSeconds: Math.min(720, Math.max(15, draft.durationSeconds)), targetEpisodeCount: Math.min(100, Math.max(1, draft.targetEpisodeCount)) });
  const ensureProject = async () => { if (project) return project; const created = await api.createProject(projectInput({ ...setupDraft, title: setupDraft.title.trim() || getProjectTitle(scriptText) })); setProject(created); return created; };
  const saveProjectSetup = () => run("setup", async () => { const next = project ? await api.updateProject(project.id, projectInput(setupDraft)) : await ensureProject(); setProject(next); setHomeVisible(false); setDashboard(await api.dashboard()); setStage("format"); }, "项目设定已保存，请导入剧本");
  const generateProjectScript = () => run("generate", async () => { const input = projectInput(setupDraft); const next = project ? await api.updateProject(project.id, input) : await api.createProject(input); const result = await api.generateScript(next.id, input); const data = await api.pipeline(next.id); setProject(result.project); setScriptText(result.scriptText); setPipeline(data); setHomeVisible(false); setDashboard(await api.dashboard()); setStage("format"); }, "剧本草案已生成并保存，请开始格式化");
  const formatScript = () => run("format", async () => { const next = await ensureProject(); const result = await api.format(next.id, scriptText); setProject(result.project); setPipeline(await api.pipeline(next.id)); setStage("format"); }, "剧本已整理为标准格式");
  const extractEpisodes = () => run("episodes", async () => { const result = await api.extractEpisodes(project!.id); setProject(result.project); setPipeline((current) => ({ ...current, episodes: result.episodes })); setStage("episodes"); return result.episodes.length; }, (count) => `已拆分 ${count} 集剧情`);
  const extractSubjects = () => run("subjects", async () => { const result = await api.extractSubjects(project!.id); setProject(result.project); setPipeline((current) => ({ ...current, subjects: result.subjects })); setStage("subjects"); }, "已提取角色、场景与道具");
  const extractShots = () => run("shots", async () => { const result = await api.extractShots(project!.id); setProject(result.project); setPipeline((current) => ({ ...current, shots: result.shots })); setStage("shots"); return result.shots.length; }, (count) => `已生成 ${count} 个镜头`);
  const renderVideo = (shot?: Shot, references: Subject[] = [], model?: VideoSettings["model"], duration?: number, options?: { prompt: string; audioMode: VideoAudioMode; speechRate: VideoSpeechRate; bgm: boolean; continuityMode: VideoContinuityMode }) => run("render", async () => { setToast(shot ? `镜头 ${shot.episodeNumber}-${shot.shotOrder} 视频生成中` : "视频生成中"); setVideoDialogShot(null); const job = await api.render(project!.id, { ...(shot ? { shotId: shot.id } : {}), referenceSubjectIds: references.map((subject) => subject.id), model: model ?? videoSettings?.model, ...(duration ? { duration } : {}), ...options }); setSubmittedRenderJobId(job.id); const data = await api.pipeline(project!.id); setPipeline(data); setProject(data.project); await refresh(); return job; }, () => shot ? `镜头 ${shot.episodeNumber}-${shot.shotOrder} 视频生成中` : "视频生成中");
  const deleteProject = (item: Project) => setDeleteTarget(item);
  const deleteSubject = (item: Subject) => setDeleteSubjectTarget(item);
  const confirmDeleteProject = () => {
    if (!deleteTarget) return;
    const item = deleteTarget;
    setDeleteTarget(null);
    void run("delete", async () => { await api.deleteProject(item.id); if (project?.id === item.id) goHome(); await refresh(); if (projectManagerVisible) await refreshProjectManager(); }, "项目已删除");
  };
  const confirmDeleteSubject = () => {
    if (!deleteSubjectTarget || !project) return;
    const item = deleteSubjectTarget;
    setDeleteSubjectTarget(null);
    setImageDialogSubject((current) => current?.id === item.id ? null : current);
    void run("deleteSubject", async () => {
      const result = await api.deleteSubject(project.id, item.id);
      setProject(result.project);
      setPipeline((current) => ({ ...current, subjects: result.subjects }));
    }, "主体已删除");
  };
  const openSettings = () => {
    setSettingsOpen(true);
    setSettingsBusy(true);
    void Promise.all([api.llmSettings(), api.imageSettings(), api.videoSettings()]).then(([llm, image, video]) => {
      setSettings(llm);
      setImageSettings(image);
      setVideoSettings(video);
      setImageSettingsDraft({ provider: image.provider, apiKey: "", model: image.model, apiBase: image.apiBase });
      setVideoSettingsDraft({ provider: video.provider, apiKey: "", model: video.model, apiBase: video.apiBase });
    }).catch((caught) => setToast(caught instanceof Error ? caught.message : "模型设置读取失败")).finally(() => setSettingsBusy(false));
  };
  const saveSettings = async () => {
    if (settingsBusy) return;
    setSettingsBusy(true);
    try {
      const [updatedLlm, updatedImage, updatedVideo] = await Promise.all([
        api.saveLlmSettings({ ...(apiKeyDraft.trim() ? { apiKey: apiKeyDraft.trim() } : {}) }),
        api.saveImageSettings({ provider: imageSettingsDraft.provider, model: imageSettingsDraft.model.trim(), apiBase: imageSettingsDraft.apiBase.trim(), ...(imageSettingsDraft.apiKey.trim() ? { apiKey: imageSettingsDraft.apiKey.trim() } : {}) }),
        api.saveVideoSettings({ provider: videoSettingsDraft.provider, model: videoSettingsDraft.model, apiBase: videoSettingsDraft.apiBase.trim(), ...(videoSettingsDraft.apiKey.trim() ? { apiKey: videoSettingsDraft.apiKey.trim() } : {}) }),
      ]);
      setSettings(updatedLlm);
      setImageSettings(updatedImage);
      setVideoSettings(updatedVideo);
      setApiKeyDraft("");
      setImageSettingsDraft((current) => ({ ...current, apiKey: "" }));
      setVideoSettingsDraft((current) => ({ ...current, apiKey: "" }));
      setToast("模型设置已保存");
    } catch (caught) { setToast(caught instanceof Error ? caught.message : "模型设置保存失败"); }
    finally { setSettingsBusy(false); }
  };
  const openSubjectImageDialog = (subject: Subject) => {
    const role = subject.role === "character" ? "角色" : subject.role === "location" ? "场景" : "道具";
    const roleRequirement = subject.role === "location"
      ? "生成要求：只呈现完整、空置、无人占用的场景设定图；不要出现人物、动物、手、人体、群演或正在发生的动作。完整展示房间边界、墙面、地面、天花板、门窗、出入口、固定家具设备、空间动线和相对位置；房屋布局必须符合真实建筑逻辑，禁止房间拼接、物件漂浮、穿模、悬空家具和无法到达的出入口；无文字，无水印。"
      : subject.role === "prop"
        ? "生成要求：只呈现完整单体物品设定图；不要出现人物、手、人体、房间、桌面或其他道具。展示物品完整外形、正反侧结构、比例、材质、颜色、纹理、接口和开合部件，不要只截取局部或描绘使用中的瞬间；无文字，无水印。"
        : "生成要求：只呈现当前主体的单一阶段、单一人物，主体清晰完整，构图简洁；禁止多年龄、多版本、拼图、分屏或对比图；无文字，无水印。";
    const descriptionLabel = subject.role === "location" ? "场景结构描述（仅作为空间事实，不得把其中人物画出来）" : subject.role === "prop" ? "物品结构描述（仅作为物品事实，不得把使用者或使用场景画出来）" : "主体描述";
    const prompt = [`视觉风格：${project?.style || "电影写实"}`, `${role}名称：${subject.name}`, `${descriptionLabel}：${subject.description || "未设定"}`, `主体提示词：${subject.visualPrompt || "未设定"}`, roleRequirement].join("\n");
    setSubjectImageDraft({ prompt, model: imageSettings?.model || imageModelOptions[0], resolution: "2K", aspectRatio: (project?.aspectRatio as ImageAspectRatio | undefined) ?? "1:1", referenceName: "" });
    setImageDialogSubject(subject);
    if (!imageSettings) void api.imageSettings().then((next) => { setImageSettings(next); setSubjectImageDraft((current) => ({ ...current, model: next.model || current.model })); }).catch((caught) => setToast(caught instanceof Error ? caught.message : "图片模型设置读取失败"));
  };
  const selectSubjectReference = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setToast("参考图不能超过 8MB"); return; }
    const reader = new FileReader();
    reader.onload = () => setSubjectImageDraft((current) => ({ ...current, referenceImage: String(reader.result ?? ""), referenceName: file.name }));
    reader.onerror = () => setToast("参考图读取失败");
    reader.readAsDataURL(file);
  };
  const generateSubjectImage = async () => {
    const subject = imageDialogSubject;
    if (!project || !subject || generatingSubjectIds.includes(subject.id) || subjectImageDraft.prompt.trim().length < 10) return;
    setGeneratingSubjectIds((current) => current.includes(subject.id) ? current : [...current, subject.id]);
    setImageDialogSubject(null);
    try {
      const { referenceName: _referenceName, ...input } = subjectImageDraft;
      const result = await api.generateSubjectImage(project.id, subject.id, { ...input, prompt: input.prompt.trim(), model: input.model.trim() });
      setPipeline((current) => ({ ...current, subjects: current.subjects.map((item) => item.id === result.subject.id ? result.subject : item) }));
      setImageDialogSubject(null);
      setToast(`“${subject.name}”图片已生成（${result.size}）并保存到本地`);
    } catch (caught) { setToast(caught instanceof Error ? caught.message : "主体图片生成失败"); }
    finally { setGeneratingSubjectIds((current) => current.filter((id) => id !== subject.id)); }
  };
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { const content = String(reader.result ?? ""); setScriptText(content.slice(0, MAX_SCRIPT_LENGTH)); if (content.length > MAX_SCRIPT_LENGTH) setToast("文件内容超过 200000 字符，已截取前 200000 字符"); }; reader.readAsText(file, "utf-8"); event.target.value = ""; };
  const navigate = (nextStage: Stage) => { if (sourceScriptMode && nextStage === "setup") return; const required: Record<Stage, boolean> = { setup: true, format: Boolean(project), episodes: pipeline.document?.formatStatus === "formatted", subjects: pipeline.episodes.length > 0, shots: pipeline.subjects.length > 0, render: pipeline.shots.length > 0 }; if (!required[nextStage]) { setToast(`请先完成「${stages[Math.max(0, stages.findIndex((item) => item.id === nextStage) - 1)].label}」`); return; } setStage(nextStage); setMobileNavOpen(false); };
  const newWorkflow = () => { setHomeTool(null); setProjectManagerVisible(false); setAssetLibraryVisible(false); setHelpVisible(false); setNewProjectDialogOpen(true); };
  const login = (account: string, remember: boolean) => {
    window.localStorage.removeItem(LOGIN_SESSION_KEY);
    window.sessionStorage.removeItem(LOGIN_SESSION_KEY);
    (remember ? window.localStorage : window.sessionStorage).setItem(LOGIN_SESSION_KEY, account);
    setSessionUser(account);
    setUserProfile(readSavedUserProfile(account));
  };
  const saveUserProfile = (next: LocalUserProfile, message: string) => {
    try {
      window.localStorage.setItem(`${USER_PROFILE_KEY}:${sessionUser}`, JSON.stringify(next));
    } catch {
      setToast("保存失败，请更换更小的头像后重试");
      return;
    }
    setUserProfile(next);
    setAccountDialog(null);
    setToast(message);
  };
  const logout = () => {
    window.localStorage.removeItem(LOGIN_SESSION_KEY);
    window.sessionStorage.removeItem(LOGIN_SESSION_KEY);
    setSessionUser("");
    setProject(null);
    setHomeVisible(true);
    setProjectManagerVisible(false);
    setAssetLibraryVisible(false);
    setHelpVisible(false);
    setHomeTool(null);
    setSettingsOpen(false);
    setAccountMenuOpen(false);
    setAccountDialog(null);
    setUserProfile(emptyUserProfile());
    window.scrollTo(0, 0);
  };
  const openProjectManager = () => { setHomeTool(null); setHomeSection("pipeline"); setAssetLibraryVisible(false); setHelpVisible(false); setProjectManagerVisible(true); void refreshProjectManager(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const openAssetLibrary = () => { setHomeTool(null); setHomeSection("home"); setProjectManagerVisible(false); setHelpVisible(false); setAssetLibraryVisible(true); void refreshAssetLibrary(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const openHelp = () => { setHomeTool(null); setProjectManagerVisible(false); setAssetLibraryVisible(false); setHelpVisible(true); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const openAssetStudio = (toolType: HomeToolType) => {
    setProjectManagerVisible(false);
    setAssetLibraryVisible(false);
    setHelpVisible(false);
    setHomeTool(toolType);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (toolType === "reference-video" || toolType === "keyframe-video") {
      void api.videoSettings().then(setVideoSettings).catch((caught) => setToast(caught instanceof Error ? caught.message : "视频模型设置读取失败"));
    } else if (toolType !== "voice-clone" && toolType !== "text-to-speech" && toolType !== "prompt-workshop" && toolType !== "image-upscale") {
      void api.imageSettings().then(setImageSettings).catch((caught) => setToast(caught instanceof Error ? caught.message : "图片模型设置读取失败"));
    }
  };
  const chooseNewProjectMode = (hasScript: boolean) => { setNewProjectDialogOpen(false); setProject(null); setSourceScriptMode(hasScript); setPipeline(emptyPipeline()); setScriptText(""); setSetupDraft({ title: hasScript ? "已有剧本项目" : "", logline: "", genre: "悬疑", style: "电影写实", aspectRatio: "16:9", durationSeconds: 60, targetEpisodeCount: 3 }); setMobileNavOpen(false); if (hasScript) { setExistingScriptSetupOpen(true); return; } setHomeVisible(false); setStage("setup"); };
  const confirmExistingScriptSetup = () => run("setup", async () => { const next = await api.createProject(projectInput(setupDraft)); setProject(next); setHomeVisible(false); setExistingScriptSetupOpen(false); setStage("format"); setDashboard(await api.dashboard()); }, "项目设定已保存，请导入剧本");
  const goHome = () => { setProject(null); setSourceScriptMode(false); setHomeVisible(true); setProjectManagerVisible(false); setAssetLibraryVisible(false); setHelpVisible(false); setHomeTool(null); setHomeSection("home"); window.scrollTo(0, 0); setStage("setup"); setMobileNavOpen(false); };
  const saveShotEdits = async (shot: Shot, input: { location: string; action: string; visualPrompt: string }) => {
    try {
      const updated = await api.updateShot(shot.projectId, shot.id, input);
      setPipeline((current) => ({ ...current, shots: current.shots.map((item) => item.id === updated.id ? updated : item) }));
      setVideoPreview((current) => current?.shot.id === updated.id ? { ...current, shot: updated } : current);
      setToast("分镜内容已保存");
      return true;
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : "分镜内容保存失败");
      return false;
    }
  };
  const settingsDialog = settingsOpen && <SettingsDialog settings={settings} imageSettings={imageSettings} videoSettings={videoSettings} draft={apiKeyDraft} imageDraft={imageSettingsDraft} videoDraft={videoSettingsDraft} busy={settingsBusy} onDraftChange={setApiKeyDraft} onImageDraftChange={setImageSettingsDraft} onVideoDraftChange={setVideoSettingsDraft} onSave={() => void saveSettings()} onClose={() => setSettingsOpen(false)} />;
  const subjectImageDialog = <>{imageDialogSubject && <SubjectImageDialog subject={imageDialogSubject} draft={subjectImageDraft} configured={imageSettings?.configured} busy={generatingSubjectIds.includes(imageDialogSubject.id)} onDraftChange={setSubjectImageDraft} onReference={selectSubjectReference} onGenerate={() => void generateSubjectImage()} onConfigure={() => { setImageDialogSubject(null); openSettings(); }} onClose={() => { if (!generatingSubjectIds.includes(imageDialogSubject.id)) setImageDialogSubject(null); }} />}{subjectImagePreview && <SubjectImagePreviewDialog subject={subjectImagePreview} onClose={() => setSubjectImagePreview(null)} />}</>;
  const previousVideoDialogShot = videoDialogShot ? pipeline.shots
    .filter((shot) => shot.episodeNumber === videoDialogShot.episodeNumber && shot.shotOrder < videoDialogShot.shotOrder)
    .sort((left, right) => right.shotOrder - left.shotOrder)[0] : undefined;
  const videoDialog = videoDialogShot && <ShotVideoDialog key={videoDialogShot.id} shot={videoDialogShot} previousShot={previousVideoDialogShot} subjects={pipeline.subjects} videoModel={videoSettings?.model} initialPrompt={videoDialogInitialPrompt} busy={workingAction === "render"} onGenerate={(references, model, duration, options) => renderVideo(videoDialogShot, references, model, duration, options)} onClose={() => { if (workingAction !== "render") { setVideoDialogShot(null); setVideoDialogInitialPrompt(null); } }} />;
  const videoPreviewDialog = videoPreview && <ShotVideoPreviewDialog shot={videoPreview.shot} url={videoPreview.url} history={renderJobs.filter((job) => job.shotId === videoPreview.shot.id && job.outputUrl).map((job) => ({ id: job.id, outputUrl: job.outputUrl!, createdAt: job.createdAt, generationPrompt: job.generationPrompt }))} onSave={(input) => saveShotEdits(videoPreview.shot, input)} onRegenerate={(prompt) => { setVideoPreview(null); setVideoDialogInitialPrompt(prompt); setVideoDialogShot(videoPreview.shot); }} onClose={() => setVideoPreview(null)} />;
  const subjectDeleteDialog = deleteSubjectTarget && <DeleteSubjectDialog subject={deleteSubjectTarget} busy={workingAction === "deleteSubject"} onConfirm={confirmDeleteSubject} onClose={() => { if (workingAction !== "deleteSubject") setDeleteSubjectTarget(null); }} />;

  if (loading) return <div className="loading-screen"><LoaderCircle className="spin" size={24} /><span>正在载入工作区</span></div>;
  if (!sessionUser) return <LoginScreen coverUrl={dashboard?.projects.find((item) => item.coverUrl)?.coverUrl ?? fallbackLoginCover} onLogin={login} />;
  const openAccountDialog = (kind: AccountDialogKind) => { setAccountMenuOpen(false); setAccountDialog(kind); };
  const accountMenu = <AccountMenu account={sessionUser} profile={userProfile} open={accountMenuOpen} onToggle={() => setAccountMenuOpen((current) => !current)} onClose={() => setAccountMenuOpen(false)} onSelect={openAccountDialog} />;
  const accountDialogNode = accountDialog && <AccountDialog kind={accountDialog} account={sessionUser} profile={userProfile} onSave={saveUserProfile} onLogout={logout} onClose={() => setAccountDialog(null)} />;
  const themeButton = <button type="button" className="icon-button theme-toggle" aria-label={theme === "dark" ? "当前为夜间模式，点击切换到日间模式" : "当前为日间模式，点击切换到夜间模式"} title={theme === "dark" ? "夜间模式" : "日间模式"} onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}>{theme === "dark" ? <Moon size={17} /> : <Sun size={17} />}</button>;
  const showHomeSection = () => {
    setHomeTool(null);
    setHomeSection("home");
    setProjectManagerVisible(false);
    setAssetLibraryVisible(false);
    setHelpVisible(false);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  };
  const homeViewKey = error ? "error" : helpVisible ? "help" : homeTool ? `tool-${homeTool}` : assetLibraryVisible ? "assets" : projectManagerVisible ? "pipeline" : homeSection;
  if (homeVisible) return <div className="app-shell home-shell">
    <header className="topbar home-topbar">
      <a className="brand" href="#home" onClick={(event) => { event.preventDefault(); showHomeSection(); }}><span className="brand-mark"><Film size={18} /></span><span className="brand-name">拥抱世界</span></a>
      <HomeNavigation active={helpVisible ? "help" : homeTool ? "tools" : assetLibraryVisible ? "assets" : projectManagerVisible ? "pipeline" : homeSection} onHome={showHomeSection} onPipeline={openProjectManager} onAssets={openAssetLibrary} onSelectTool={openAssetStudio} onCreate={newWorkflow} onHelp={openHelp} />
      <div className="top-actions">{themeButton}<button className="icon-button model-settings-button" aria-label="模型设置" title="模型设置" onClick={openSettings}><Settings2 size={17} /></button>{accountMenu}</div>
    </header>
    <div key={homeViewKey} className="home-view-transition">
      {error ? <div className="fatal-state home-fatal"><h2>工作区暂时无法连接</h2><p>{error}</p><button className="primary-button" onClick={() => void refresh()}>重新连接</button></div> : helpVisible ? <HelpStage onSelectTool={openAssetStudio} /> : homeTool === "image-upscale" ? <ImageUpscaleStudio onToast={setToast} /> : homeTool === "prompt-workshop" ? <PromptWorkshop onToast={setToast} /> : homeTool === "voice-clone" ? <VoiceCloneStudio onToast={setToast} /> : homeTool === "text-to-speech" ? <TextToSpeechStudio onToast={setToast} /> : homeTool === "reference-video" || homeTool === "keyframe-video" ? <VideoToolStudio key={homeTool} videoType={homeTool} videoSettings={videoSettings} onConfigure={openSettings} onToast={setToast} /> : homeTool ? <CharacterStudio key={homeTool} assetType={homeTool} imageSettings={imageSettings} onConfigure={openSettings} onToast={setToast} /> : assetLibraryVisible ? <AssetLibraryStage data={assetLibrary} loading={assetLibraryLoading} onCreate={openAssetStudio} /> : projectManagerVisible ? <ProjectManagerStage projects={managerProjects} loading={managerLoading} onOpen={(item, target) => void loadProject(item, target)} onDelete={deleteProject} onNew={newWorkflow} /> : <HomeStage projects={dashboard?.projects ?? []} stats={dashboard?.stats} onNew={newWorkflow} onManage={openProjectManager} onOpen={(item, target) => void loadProject(item, target)} onDelete={deleteProject} />}
    </div>
    {newProjectDialogOpen && <NewProjectDialog onHasScript={() => chooseNewProjectMode(true)} onNoScript={() => chooseNewProjectMode(false)} onClose={() => setNewProjectDialogOpen(false)} />}
    {existingScriptSetupOpen && <ExistingScriptSetupDialog draft={setupDraft} setDraft={setSetupDraft} busy={workingAction === "setup"} onConfirm={confirmExistingScriptSetup} onClose={() => { if (!workingAction) { setExistingScriptSetupOpen(false); setSourceScriptMode(false); } }} />}
    {deleteTarget && <DeleteProjectDialog project={deleteTarget} busy={workingAction === "delete"} onConfirm={confirmDeleteProject} onClose={() => setDeleteTarget(null)} />}
    {settingsDialog}{accountDialogNode}{toast && <div className="toast"><Check size={16} />{toast}</div>}
  </div>;
  return <div className="app-shell project-shell">
    <header className="topbar project-topbar"><div className="topbar-left"><a className="brand" href="#home" onClick={(event) => { event.preventDefault(); goHome(); }} aria-label="返回拥抱世界首页"><span className="brand-mark"><Film size={18} /></span><span className="brand-name">拥抱世界</span></a></div><nav className="top-steps" aria-label="项目处理步骤">{stages.slice(0, 5).filter((item) => !(sourceScriptMode && item.id === "setup")).map((item, visibleIndex) => { const itemIndex = stages.findIndex((stageItem) => stageItem.id === item.id); const done = itemIndex < currentIndex || (item.id === "format" && Boolean(pipeline.document)) || (item.id === "episodes" && pipeline.episodes.length > 0) || (item.id === "subjects" && pipeline.subjects.length > 0) || (item.id === "shots" && pipeline.shots.length > 0); return <button key={item.id} className={`${stage === item.id ? "active" : ""} ${done ? "done" : ""}`} onClick={() => navigate(item.id)}><span>{done ? <Check size={12} /> : visibleIndex + 1}</span>{item.label}</button>; })}</nav><div className="top-actions"><span className="project-top-title">{project?.title || setupDraft.title || "开始创作"}</span>{themeButton}<button className="icon-button model-settings-button" aria-label="模型设置" title="模型设置" onClick={openSettings}><Settings2 size={17} /></button>{accountMenu}</div></header>
    <main id="workspace" className="workspace"><div className="workspace-head"><div><h1>{stages[currentIndex].label}</h1><p>{stages[currentIndex].description}，每一步的结果都会成为下一步的输入。</p></div><div className="head-tools"><span className="workspace-progress">项目进度 {completion}%</span><button className="icon-button"><MoreHorizontal size={18} /></button></div></div>{error ? <div className="fatal-state"><h2>工作区暂时无法连接</h2><p>{error}</p><button className="primary-button" onClick={() => void refresh()}>重新连接</button></div> : <div className="work-area"><section className={`canvas-panel ${stage === "setup" ? "setup-canvas-panel" : ""}`}>{stage === "setup" && <SetupStage draft={setupDraft} setDraft={setSetupDraft} onNext={project || sourceScriptMode ? saveProjectSetup : generateProjectScript} working={workingAction === "setup" || workingAction === "generate"} generate={!project && !sourceScriptMode} />}{stage === "format" && pipeline.document?.formatStatus === "formatted" ? <FormatStage document={pipeline.document} onNext={extractEpisodes} working={workingAction === "episodes"} /> : stage === "format" ? <ImportStage text={scriptText} setText={setScriptText} onFile={() => fileInput.current?.click()} onNext={formatScript} working={workingAction === "format"} fileInput={fileInput} onFileChange={handleFile} /> : null}{stage === "episodes" && <EpisodesStage episodes={pipeline.episodes} onNext={extractSubjects} working={workingAction === "subjects"} />}{stage === "subjects" && <SubjectsStage key={project?.id} subjects={pipeline.subjects} onNext={extractShots} working={workingAction === "shots"} generatingSubjectId={generatingSubjectId} deletingSubjectId={workingAction === "deleteSubject" ? deleteSubjectTarget?.id ?? "pending" : null} onGenerateImage={openSubjectImageDialog} onDeleteSubject={deleteSubject} />}{stage === "shots" && <ShotsStage shots={pipeline.shots} subjects={pipeline.subjects} episodes={pipeline.episodes} jobs={renderJobs} onNext={() => setStage("render")} onGenerateVideo={(shot) => { setVideoDialogInitialPrompt(null); setVideoDialogShot(shot); }} onViewVideo={(shot, url) => setVideoPreview({ shot, url })} working={workingAction === "render"} />}{stage === "render" && <RenderStage project={project} shots={pipeline.shots} jobs={renderJobs} onCoverCreated={(coverUrl) => { setProject((current) => current ? { ...current, coverUrl } : current); setDashboard((current) => current ? { ...current, projects: current.projects.map((item) => item.id === project?.id ? { ...item, coverUrl } : item) } : current); }} onBack={() => setStage("shots")} />}</section><Inspector stage={stage} project={project} pipeline={pipeline} /></div>}</main>{subjectImageDialog}{videoDialog}{videoPreviewDialog}{subjectDeleteDialog}{settingsDialog}{toast && <div className="toast"><Check size={16} />{toast}</div>}
    {accountDialogNode}
  </div>;
}

type ProjectDraft = { title: string; logline: string; genre: string; style: string; aspectRatio: string; durationSeconds: number; targetEpisodeCount: number };
type SelectOption = { value: string; label: string };

type HomeNavigationProps = {
  active: "home" | "pipeline" | "tools" | "assets" | "help";
  onHome: () => void;
  onPipeline: () => void;
  onAssets: () => void;
  onSelectTool: (toolType: HomeToolType) => void;
  onCreate: () => void;
  onHelp: () => void;
};

function HomeNavigation({ active, onHome, onPipeline, onAssets, onSelectTool, onCreate, onHelp }: HomeNavigationProps) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const navigationRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!toolsOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => { if (navigationRef.current && !navigationRef.current.contains(event.target as Node)) setToolsOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setToolsOpen(false); };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("mousedown", closeOnOutsideClick); document.removeEventListener("keydown", closeOnEscape); };
  }, [toolsOpen]);
  const runAndClose = (action: () => void) => { setToolsOpen(false); action(); };
  const toolButton = (label: string) => {
    const toolType = ({ "角色": "character", "场景": "scene", "物品": "prop", "参考生视频": "reference-video", "首尾帧视频": "keyframe-video", "声音克隆": "voice-clone", "文转语音": "text-to-speech", "提示词工坊": "prompt-workshop", "一键高清": "image-upscale" } as Partial<Record<string, HomeToolType>>)[label];
    return <button type="button" key={label} onClick={() => runAndClose(toolType ? () => onSelectTool(toolType) : onCreate)}>{label}</button>;
  };

  return <div className="home-nav-shell" ref={navigationRef}>
    <nav className="home-nav" aria-label="首页导航">
      <button type="button" className={active === "home" && !toolsOpen ? "active" : ""} onClick={() => runAndClose(onHome)}>首页</button>
      <button type="button" className={active === "pipeline" && !toolsOpen ? "active" : ""} onClick={() => runAndClose(onPipeline)}>创作台</button>
      <button type="button" className={`home-tools-trigger ${toolsOpen || active === "tools" ? "active" : ""}`} aria-haspopup="menu" aria-expanded={toolsOpen} onClick={() => setToolsOpen((current) => !current)}>更多工具<ChevronDown size={14} /></button>
      <button type="button" className={active === "assets" ? "active" : ""} onClick={() => runAndClose(onAssets)}>资产</button>
      <button type="button" className={active === "help" ? "active" : ""} onClick={() => runAndClose(onHelp)}>帮助文档</button>
    </nav>
    {toolsOpen && <section className="home-nav-mega" aria-label="更多创作工具">
      <div className="mega-column">
        <div><span>创作</span><div className="mega-tool-list">{["角色", "场景", "物品"].map(toolButton)}</div></div>
        <div><span>AI 视频</span><div className="mega-tool-list">{["参考生视频", "首尾帧视频"].map(toolButton)}</div></div>
        <div><span>配音</span><div className="mega-tool-list">{["声音克隆", "文转语音"].map(toolButton)}</div></div>
      </div>
      <div className="mega-column">
        <div><span>更多工具</span><div className="mega-tool-list">{["一键高清", "多角度图片", "无限画布"].map(toolButton)}</div></div>
        <div className="mega-separated"><span>对口型创作</span><div className="mega-tool-list">{["文本对口型", "音频对口型", "角色替换", "分镜替换", "真人素材", "角色固定", "提示词工坊"].map(toolButton)}</div></div>
      </div>
    </section>}
  </div>;
}

type HelpTopicId = "quick-start" | "pipeline" | "creative-tools" | "voice" | "settings";
const helpTopics: Array<{ id: HelpTopicId; label: string; description: string; icon: typeof FileText }> = [
  { id: "quick-start", label: "快速开始", description: "从想法或剧本建立项目", icon: Play },
  { id: "pipeline", label: "创作流水线", description: "理解六个制作阶段", icon: Layers3 },
  { id: "creative-tools", label: "素材与视频", description: "生成主体、图片和视频", icon: Sparkles },
  { id: "voice", label: "配音与声音", description: "声音克隆与文转语音", icon: Mic2 },
  { id: "settings", label: "设置与排查", description: "模型配置和常见问题", icon: Settings2 },
];
const helpPipelineSteps = [
  { number: "01", title: "项目设定", description: "确定标题、故事简介、类型、画面风格、比例、单集时长和集数。", result: "项目规格", icon: Settings2 },
  { number: "02", title: "剧本格式化", description: "粘贴或导入剧本，整理场次、动作、对白和叙事结构。", result: "标准剧本", icon: FileText },
  { number: "03", title: "剧本解析", description: "按集提取标题、梗概和情节结构，为后续生成建立上下文。", result: "分集内容", icon: Layers3 },
  { number: "04", title: "主体生成", description: "识别角色、场景和道具，并为需要的主体生成统一视觉资产。", result: "主体资产", icon: UsersRound },
  { number: "05", title: "故事板", description: "把剧情拆成镜头，检查画面描述、对白、摄影和连续性。", result: "分镜视频", icon: ScanSearch },
  { number: "06", title: "视频合成", description: "选择已生成镜头，调整顺序并合并为可预览、可下载的成片。", result: "最终视频", icon: Combine },
];

function HelpStage({ onSelectTool }: { onSelectTool: (toolType: HomeToolType) => void }) {
  const [activeTopic, setActiveTopic] = useState<HelpTopicId>("quick-start");
  const openTool = (toolType: HomeToolType) => onSelectTool(toolType);
  return <main className="help-page" aria-labelledby="help-title">
    <div className="help-page-frame">
      <header className="help-page-head"><span className="panel-eyebrow">PRODUCT GUIDE</span><h1 id="help-title">帮助中心</h1><p>从剧本构思到视频成片，快速了解工作区的完整使用方式。</p></header>
      <div className="help-layout">
        <aside className="help-sidebar" aria-label="帮助文档目录">
          <span className="help-nav-label">使用指南</span>
          <nav className="help-topic-nav">
            {helpTopics.map((topic) => { const Icon = topic.icon; return <button type="button" key={topic.id} className={activeTopic === topic.id ? "active" : ""} aria-current={activeTopic === topic.id ? "page" : undefined} onClick={() => setActiveTopic(topic.id)}><Icon size={17} /><span><strong>{topic.label}</strong><small>{topic.description}</small></span></button>; })}
          </nav>
        </aside>
        <div className="help-content" tabIndex={0}>
          {activeTopic === "quick-start" && <article className="help-article">
            <header className="help-article-head"><span>GETTING STARTED</span><h3>从一个故事开始创作</h3><p>创建项目时先选择你的内容起点。两种方式最终都会进入同一套创作流水线。</p></header>
            <div className="help-facts"><div><strong>2</strong><span>种项目起点</span></div><div><strong>6</strong><span>个制作阶段</span></div><div><strong>7</strong><span>项独立工具</span></div></div>
            <section className="help-section"><div className="help-section-title"><span>01</span><div><h4>选择创建方式</h4><p>根据手头已有内容决定从哪里开始。</p></div></div><div className="help-start-grid"><div><FileText size={20} /><strong>已有剧本</strong><p>先填写内容类型、视觉风格、画幅和时长，再粘贴或导入剧本进行格式化。</p></div><div><WandSparkles size={20} /><strong>没有剧本</strong><p>填写故事标题、简介和生成规格，由模型生成剧本草案后继续制作。</p></div></div></section>
            <section className="help-section"><div className="help-section-title"><span>02</span><div><h4>完成基础设置</h4><p>标题用于项目识别；类型与视觉风格会影响主体和分镜的生成方向；画幅与时长决定最终视频规格。</p></div></div><div className="help-tip"><Check size={16} /><p><strong>建议先确认规格。</strong>进入后续步骤前检查画幅、单集时长和目标集数，可减少重新生成。</p></div></section>
            <section className="help-section"><div className="help-section-title"><span>03</span><div><h4>逐步完成制作</h4><p>顶部步骤条会显示当前位置和已完成阶段。每一步的结果都会成为下一步的输入。</p></div></div><div className="help-inline-flow"><span>剧本</span><ArrowRight size={14} /><span>分集</span><ArrowRight size={14} /><span>主体</span><ArrowRight size={14} /><span>分镜</span><ArrowRight size={14} /><span>成片</span></div></section>
          </article>}
          {activeTopic === "pipeline" && <article className="help-article">
            <header className="help-article-head"><span>PRODUCTION PIPELINE</span><h3>六步完成剧本到视频</h3><p>按照顺序推进可以保持剧本、主体与镜头信息一致，也可以随时返回已完成的步骤复查内容。</p></header>
            <div className="help-pipeline-list">{helpPipelineSteps.map((step) => { const Icon = step.icon; return <div className="help-pipeline-item" key={step.number}><span className="help-pipeline-number">{step.number}</span><span className="help-pipeline-icon"><Icon size={18} /></span><div><strong>{step.title}</strong><p>{step.description}</p></div><small>{step.result}</small></div>; })}</div>
            <div className="help-tip"><Check size={16} /><p><strong>保持连续性。</strong>修改前置步骤后，重新检查下游生成结果，确保角色、场景和镜头描述仍然匹配。</p></div>
          </article>}
          {activeTopic === "creative-tools" && <article className="help-article">
            <header className="help-article-head"><span>CREATIVE TOOLS</span><h3>独立生成素材与视频</h3><p>“更多工具”适合快速制作单项资产，不必先创建完整项目。生成设置沿用右上角的模型配置。</p></header>
            <section className="help-section"><div className="help-section-title"><span>01</span><div><h4>角色、场景与物品</h4><p>输入清晰的画面描述，选择模型、比例和分辨率，可上传参考图来约束外观。</p></div></div><div className="help-tool-grid"><button type="button" onClick={() => openTool("character")}><UsersRound size={19} /><span><strong>角色生成</strong><small>人物外貌、服装与设定图</small></span></button><button type="button" onClick={() => openTool("scene")}><Layers3 size={19} /><span><strong>场景生成</strong><small>空间、环境与氛围画面</small></span></button><button type="button" onClick={() => openTool("prop")}><Sparkles size={19} /><span><strong>物品生成</strong><small>道具、器物与产品素材</small></span></button></div></section>
            <section className="help-section"><div className="help-section-title"><span>02</span><div><h4>AI 视频</h4><p>参考生视频适合根据多张参考图塑造主体；首尾帧视频适合精确控制镜头开始与结束状态。</p></div></div><div className="help-tool-grid two-columns"><button type="button" onClick={() => openTool("reference-video")}><Clapperboard size={19} /><span><strong>参考生视频</strong><small>参考图 + 提示词生成动态镜头</small></span></button><button type="button" onClick={() => openTool("keyframe-video")}><Combine size={19} /><span><strong>首尾帧视频</strong><small>用关键帧控制镜头变化</small></span></button></div></section>
            <div className="help-tip"><Check size={16} /><p><strong>提示词写清主体、动作、环境和摄影。</strong>需要稳定角色时，优先提供清晰且风格一致的参考图。</p></div>
          </article>}
          {activeTopic === "voice" && <article className="help-article">
            <header className="help-article-head"><span>VOICE WORKFLOW</span><h3>创建声音并生成配音</h3><p>声音克隆和文转语音共用 MiniMax 语音服务。页面右上角状态会显示服务是否已连接。</p></header>
            <div className="help-voice-grid"><section><div className="help-voice-heading"><span><Mic2 size={19} /></span><div><small>STEP 01</small><h4>声音克隆</h4></div></div><ol><li><strong>命名声音</strong><span>填写便于识别的名称和主要语言。</span></li><li><strong>上传样本</strong><span>支持 MP3、WAV、M4A，最大 20MB，时长至少 3 秒。</span></li><li><strong>填写文本</strong><span>试听文本用于生成预览；准确填写样本逐字稿可提升克隆效果。</span></li><li><strong>确认授权</strong><span>仅上传已获得明确授权的声音并开始克隆。</span></li></ol><button type="button" className="secondary-button" onClick={() => openTool("voice-clone")}>打开声音克隆</button></section><section><div className="help-voice-heading"><span><Headphones size={19} /></span><div><small>STEP 02</small><h4>文转语音</h4></div></div><ol><li><strong>输入朗读文本</strong><span>支持对白、旁白与播报文本，单次最多 10,000 字符。</span></li><li><strong>选择声音</strong><span>可使用系统声音或已经创建的克隆声音。</span></li><li><strong>调整表达</strong><span>设置语言、情绪、语速、音量、音高、格式和采样率。</span></li><li><strong>试听并下载</strong><span>生成后可在线播放，并下载 MP3 或 FLAC 文件。</span></li></ol><button type="button" className="secondary-button" onClick={() => openTool("text-to-speech")}>打开文转语音</button></section></div>
            <div className="help-tip warning"><AudioLines size={16} /><p><strong>样本质量决定克隆效果。</strong>使用单人、无背景音乐、无混响且音量稳定的清晰人声。</p></div>
          </article>}
          {activeTopic === "settings" && <article className="help-article">
            <header className="help-article-head"><span>SETTINGS & SUPPORT</span><h3>模型配置与常见问题</h3><p>右上角设置入口用于管理剧本、图片和视频生成服务；声音服务由部署环境统一配置。</p></header>
            <section className="help-section"><div className="help-section-title"><span>01</span><div><h4>开始前检查</h4><p>各工作区顶部的连接状态会提示当前服务是否可用。</p></div></div><div className="help-config-list"><div><FileText size={17} /><span><strong>剧本模型</strong><small>用于生成、格式化和解析剧本内容。</small></span></div><div><ImagePlus size={17} /><span><strong>图片模型</strong><small>用于角色、场景、物品和主体图片。</small></span></div><div><Clapperboard size={17} /><span><strong>视频模型</strong><small>用于参考图、关键帧和故事板镜头。</small></span></div><div><Mic2 size={17} /><span><strong>MiniMax 语音</strong><small>需要部署者配置 MINIMAX_API_KEY。</small></span></div></div></section>
            <section className="help-section"><div className="help-section-title"><span>02</span><div><h4>常见问题</h4><p>遇到异常时先根据页面状态提示检查以下项目。</p></div></div><div className="help-faq"><details open><summary>生成按钮为什么不可用？<ChevronDown size={15} /></summary><p>通常是必填内容、参考素材或授权确认尚未完成，也可能是对应模型服务未配置。检查页面顶部连接状态和输入区提示。</p></details><details><summary>项目和生成记录保存在哪里？<ChevronDown size={15} /></summary><p>项目数据保存在当前设备的本地工作区；已生成的图片、声音和视频可在“资产”中统一查看。</p></details><details><summary>如何继续之前的项目？<ChevronDown size={15} /></summary><p>打开“创作台”，使用项目名称、简介、类型或风格搜索，然后点击项目卡片继续进入创作流程。</p></details><details><summary>生成失败或等待时间过长怎么办？<ChevronDown size={15} /></summary><p>先确认模型配置和网络连接。视频生成通常比文本和图片更久；若页面返回错误，按提示调整素材或稍后重试。</p></details></div></section>
          </article>}
        </div>
      </div>
    </div>
  </main>;
}

function UserAvatar({ account, profile, large = false }: { account: string; profile: LocalUserProfile; large?: boolean }) {
  const initial = (profile.displayName || account).trim().slice(0, 1).toLocaleUpperCase() || "M";
  return <span className={`user-avatar-face ${large ? "large" : ""}`}>{profile.avatarDataUrl ? <img src={profile.avatarDataUrl} alt="用户头像" /> : initial}</span>;
}

function AccountMenu({ account, profile, open, onToggle, onClose, onSelect }: { account: string; profile: LocalUserProfile; open: boolean; onToggle: () => void; onClose: () => void; onSelect: (kind: AccountDialogKind) => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeMenu = (event: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose(); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("mousedown", closeMenu); document.removeEventListener("keydown", closeOnEscape); };
  }, [open, onClose]);
  const name = profile.displayName || account;

  return <div className="account-control" ref={menuRef}>
    <button type="button" className={`avatar ${open ? "active" : ""}`} aria-label="打开账户菜单" aria-haspopup="menu" aria-expanded={open} title={`${name} · 账户菜单`} onClick={onToggle}><UserAvatar account={account} profile={profile} /></button>
    {open && <div className="account-menu" role="menu" aria-label="账户菜单">
      <div className="account-menu-profile"><UserAvatar account={account} profile={profile} /><span><strong>{name}</strong><small>{profile.email || account}</small></span></div>
      <div className="account-menu-items">
        <button type="button" role="menuitem" onClick={() => onSelect("profile")}><UserRound size={16} /><span><strong>个人信息</strong><small>查看账号并修改昵称</small></span></button>
        <button type="button" role="menuitem" onClick={() => onSelect("avatar")}><ImagePlus size={16} /><span><strong>修改头像</strong><small>使用本地图片作为头像</small></span></button>
        <button type="button" role="menuitem" onClick={() => onSelect("email")}><Mail size={16} /><span><strong>{profile.email ? "更换邮箱" : "绑定邮箱"}</strong><small>{profile.email || "尚未绑定邮箱"}</small></span></button>
      </div>
      <div className="account-menu-items account-menu-danger"><button type="button" role="menuitem" onClick={() => onSelect("logout")}><LogOut size={16} /><span><strong>退出登录</strong><small>返回登录页面</small></span></button></div>
    </div>}
  </div>;
}

function AccountDialog({ kind, account, profile, onSave, onLogout, onClose }: { kind: AccountDialogKind; account: string; profile: LocalUserProfile; onSave: (profile: LocalUserProfile, message: string) => void; onLogout: () => void; onClose: () => void }) {
  const [displayName, setDisplayName] = useState(profile.displayName || account);
  const [email, setEmail] = useState(profile.email);
  const [avatarDataUrl, setAvatarDataUrl] = useState(profile.avatarDataUrl);
  const [error, setError] = useState("");
  const avatarInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const selectAvatar = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("请选择图片文件"); return; }
    if (file.size > 2 * 1024 * 1024) { setError("头像图片不能超过 2MB"); return; }
    const reader = new FileReader();
    reader.onload = () => { setAvatarDataUrl(String(reader.result ?? "")); setError(""); };
    reader.onerror = () => setError("头像读取失败，请重新选择");
    reader.readAsDataURL(file);
    event.target.value = "";
  };
  const backdropProps = { className: "settings-backdrop", role: "presentation", onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) onClose(); } };

  if (kind === "logout") return <div {...backdropProps}><section className="settings-dialog account-dialog logout-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-title">
    <div className="settings-dialog-head"><div><span className="panel-eyebrow">ACCOUNT</span><h2 id="logout-title">确定退出登录吗？</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭退出确认"><X size={18} /></button></div>
    <div className="account-logout-copy"><LogOut size={19} /><div><strong>将结束当前登录状态</strong><p>你的项目和个人资料仍会保存在当前设备中。</p></div></div>
    <div className="settings-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="danger-button" onClick={onLogout}><LogOut size={15} />退出登录</button></div>
  </section></div>;

  if (kind === "avatar") return <div {...backdropProps}><section className="settings-dialog account-dialog" role="dialog" aria-modal="true" aria-labelledby="avatar-title">
    <div className="settings-dialog-head"><div><span className="panel-eyebrow">PROFILE IMAGE</span><h2 id="avatar-title">修改头像</h2><p>图片只会保存在当前设备。</p></div><button className="icon-button" onClick={onClose} aria-label="关闭头像设置"><X size={18} /></button></div>
    <div className="avatar-editor"><UserAvatar account={account} profile={{ ...profile, avatarDataUrl }} large /><div><button className="secondary-button" type="button" onClick={() => avatarInput.current?.click()}><Upload size={15} />选择图片</button>{avatarDataUrl && <button className="text-button" type="button" onClick={() => setAvatarDataUrl("")}>移除头像</button>}<input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={selectAvatar} /></div><small>支持 JPG、PNG、WebP，最大 2MB</small></div>
    {error && <p className="account-dialog-error" role="alert">{error}</p>}
    <div className="settings-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={() => onSave({ ...profile, avatarDataUrl }, "头像已更新")}><Check size={15} />保存头像</button></div>
  </section></div>;

  if (kind === "email") {
    const emailReady = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    const submitEmail = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (emailReady) onSave({ ...profile, email: email.trim() }, profile.email ? "邮箱已更新" : "邮箱已绑定"); else setError("请输入有效的邮箱地址"); };
    return <div {...backdropProps}><section className="settings-dialog account-dialog" role="dialog" aria-modal="true" aria-labelledby="email-title">
      <div className="settings-dialog-head"><div><span className="panel-eyebrow">EMAIL</span><h2 id="email-title">{profile.email ? "更换绑定邮箱" : "绑定邮箱"}</h2><p>用于完善当前设备上的个人资料。</p></div><button className="icon-button" onClick={onClose} aria-label="关闭邮箱设置"><X size={18} /></button></div>
      <form onSubmit={submitEmail}><label className="account-dialog-field"><span>邮箱地址</span><div><Mail size={16} /><input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }} autoComplete="email" placeholder="name@example.com" autoFocus /></div></label>{error && <p className="account-dialog-error" role="alert">{error}</p>}<div className="settings-actions"><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={!email.trim()}><Check size={15} />确认绑定</button></div></form>
    </section></div>;
  }

  const submitProfile = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const nextName = displayName.trim(); if (nextName.length < 2) { setError("昵称至少需要 2 个字符"); return; } onSave({ ...profile, displayName: nextName }, "个人信息已保存"); };
  return <div {...backdropProps}><section className="settings-dialog account-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title">
    <div className="settings-dialog-head"><div><span className="panel-eyebrow">PERSONAL PROFILE</span><h2 id="profile-title">个人信息</h2><p>查看账号信息并设置显示昵称。</p></div><button className="icon-button" onClick={onClose} aria-label="关闭个人信息"><X size={18} /></button></div>
    <div className="account-profile-lead"><UserAvatar account={account} profile={profile} large /><div><strong>{profile.displayName || account}</strong><small>{profile.email || "邮箱未绑定"}</small></div></div>
    <form onSubmit={submitProfile}><label className="account-dialog-field"><span>登录账号</span><div className="readonly"><UserRound size={16} /><input value={account} readOnly /></div></label><label className="account-dialog-field"><span>显示昵称</span><div><Pencil size={16} /><input value={displayName} onChange={(event) => { setDisplayName(event.target.value); setError(""); }} maxLength={24} placeholder="请输入昵称" autoFocus /></div></label>{error && <p className="account-dialog-error" role="alert">{error}</p>}<div className="settings-actions"><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="submit" disabled={!displayName.trim()}><Check size={15} />保存资料</button></div></form>
  </section></div>;
}

function LoginScreen({ coverUrl, onLogin }: { coverUrl: string; onLogin: (account: string, remember: boolean) => void }) {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const ready = account.trim().length >= 2 && password.length >= 4;
  const authenticate = () => {
    setAttempted(true);
    if (ready) onLogin(account.trim(), remember);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    authenticate();
  };

  return <main className="login-screen">
    <section className="login-visual" aria-label="作品画面">
      <img src={coverUrl} alt="" />
      <div className="login-visual-shade" />
      <div className="login-brand"><span className="brand-mark"><Film size={18} /></span><span><strong>拥抱世界</strong><small>SCRIPT TO VIDEO</small></span></div>
      <div className="login-story"><strong>让每一个镜头，<br />都从好故事开始。</strong></div>
    </section>
    <section className="login-panel">
      <div className="login-form-wrap">
        <span className="panel-eyebrow">LOCAL WORKSPACE ACCESS</span>
        <h1>欢迎回来</h1>
        <p>登录后继续你的剧本到视频创作。</p>
        <form className="login-form" onSubmit={submit} noValidate>
          <label className="login-field"><span>账号</span><div><UserRound size={17} /><input value={account} onChange={(event) => setAccount(event.target.value)} autoComplete="username" placeholder="请输入账号" aria-invalid={attempted && account.trim().length < 2} /></div></label>
          <label className="login-field"><span>密码</span><div><LockKeyhole size={17} /><input type={passwordVisible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="请输入密码" aria-invalid={attempted && password.length < 4} /><button type="button" aria-label={passwordVisible ? "隐藏密码" : "显示密码"} title={passwordVisible ? "隐藏密码" : "显示密码"} onClick={() => setPasswordVisible((current) => !current)}>{passwordVisible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
          <div className="login-options"><label><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>下次自动进入</span></label><small>仅保存在当前设备</small></div>
          {attempted && !ready && <p className="login-error" role="alert">请输入至少 2 位账号和 4 位密码</p>}
          <div className="login-actions">
            <button className="login-submit" type="submit" disabled={!account.trim() || !password}>登录</button>
            <button className="login-register" type="button" disabled={!account.trim() || !password} onClick={authenticate}>注册</button>
          </div>
        </form>
        <div className="login-note"><LogOut size={14} /><span>密码不会保存，登录状态可随时从右上角退出。</span></div>
      </div>
      <footer><span>拥抱世界 AI</span><small>LOCAL FIRST · PRIVATE BY DEFAULT</small></footer>
    </section>
  </main>;
}

type CharacterStudioDraft = {
  name: string;
  description: string;
  referenceImage?: string;
  referenceName: string;
  style: string;
  model: string;
  resolution: ImageResolution;
  aspectRatio: ImageAspectRatio;
  watermark: boolean;
};

const studioAssetConfig: Record<StudioAssetType, {
  title: string;
  englishTitle: string;
  nameLabel: string;
  descriptionLabel: string;
  description: string;
  namePlaceholder: string;
  descriptionPlaceholder: string;
  exampleName: string;
  examplePrompt: string;
  requirement: string;
  defaultRatio: ImageAspectRatio;
}> = {
  character: {
    title: "角色生成", englishTitle: "CHARACTER STUDIO", nameLabel: "角色名称", descriptionLabel: "角色描述",
    description: "定义角色的外观与气质，生成结果会自动保存在本地。", namePlaceholder: "例如：林默",
    descriptionPlaceholder: "描述年龄、五官、发型、服装、体态、气质和关键识别特征",
    exampleName: "林默",
    examplePrompt: "28岁亚洲男性，短黑发，眉眼锋利，身形修长，穿深灰色长风衣与黑色高领衫，沉静克制，左眉尾有一道浅疤。角色四视图设定，同一画布依次展示正面、左侧、背面、右侧，全身完整，四个视图的人物比例、脸型、发型、服装和配饰完全一致。",
    requirement: "角色四视图设定图，在同一画布按顺序展示正面、左侧、背面、右侧；同一人物、同一年龄、同一服装，四个视图等高等比例，全身完整，背景纯净；禁止额外人物、动作场景和文字。",
    defaultRatio: "3:2",
  },
  scene: {
    title: "场景生成", englishTitle: "SCENE STUDIO", nameLabel: "场景名称", descriptionLabel: "场景描述",
    description: "固定空间结构、材质与光线，为后续镜头提供一致的场景参考。", namePlaceholder: "例如：雨夜旧车站",
    descriptionPlaceholder: "描述空间布局、建筑结构、材质、时间、天气、灯光和关键陈设",
    exampleName: "雨夜旧车站",
    examplePrompt: "废弃的欧式小镇车站，拱形铁架屋顶，湿润石质站台，左侧旧售票亭，右侧两条生锈铁轨，尽头有红色信号灯，深夜细雨与冷蓝月光。场景四视图设定，同一画布展示入口视角、正向全景、反向全景、侧向全景，空间结构、门窗、轨道和固定陈设的位置完全一致。",
    requirement: "场景四视图设定图，在同一画布展示入口视角、正向全景、反向全景、侧向全景；保持建筑结构、空间尺度、门窗、出入口和固定陈设完全一致；空置无人，禁止人物、拼接错误、漂浮物和文字。",
    defaultRatio: "16:9",
  },
  prop: {
    title: "物品生成", englishTitle: "PROP STUDIO", nameLabel: "物品名称", descriptionLabel: "物品描述",
    description: "明确物品的结构、材质和识别细节，生成可复用的设定参考。", namePlaceholder: "例如：黄铜怀表",
    descriptionPlaceholder: "描述形状、尺寸、材质、颜色、纹理、接口和开合结构",
    exampleName: "黄铜怀表",
    examplePrompt: "掌心大小的旧黄铜机械怀表，圆形表壳，表盖刻有放射状花纹，边缘轻微磨损，白色珐琅表盘，黑色罗马数字，顶部连接细链。物品四视图设定，同一画布依次展示正面、左侧、背面、右侧，四个视图尺寸一致，并补充表盖打开状态的结构细节。",
    requirement: "物品四视图设定图，在同一画布按顺序展示正面、左侧、背面、右侧；同一物品、等比例、完整不裁切，准确呈现材质、纹理、接口和开合部件；纯净背景，禁止人物、手、使用场景和文字。",
    defaultRatio: "3:2",
  },
};

type UpscaleMode = "balanced" | "detail" | "portrait";
type UpscaleSource = { name: string; size: number; width: number; height: number; url: string };

const formatFileSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const loadPreviewImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error("图片读取失败，请重新选择"));
  image.src = url;
});
const nextPaint = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

function ImageUpscaleStudio({ onToast }: { onToast: (message: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const sourceUrlRef = useRef("");
  const outputUrlRef = useRef("");
  const [source, setSource] = useState<UpscaleSource | null>(null);
  const [outputUrl, setOutputUrl] = useState("");
  const [outputBytes, setOutputBytes] = useState(0);
  const [scale, setScale] = useState<2 | 4>(2);
  const [mode, setMode] = useState<UpscaleMode>("balanced");
  const [comparison, setComparison] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pageError, setPageError] = useState("");

  useEffect(() => () => {
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
  }, []);

  const resetOutput = () => {
    if (outputUrlRef.current) URL.revokeObjectURL(outputUrlRef.current);
    outputUrlRef.current = "";
    setOutputUrl("");
    setOutputBytes(0);
    setProgress(0);
    setComparison(50);
  };
  const selectFile = async (file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setPageError("请选择 PNG、JPG 或 WebP 图片"); return; }
    if (file.size > 20 * 1024 * 1024) { setPageError("图片不能超过 20 MB"); return; }
    const url = URL.createObjectURL(file);
    try {
      const image = await loadPreviewImage(url);
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
      resetOutput();
      sourceUrlRef.current = url;
      setSource({ name: file.name, size: file.size, width: image.naturalWidth, height: image.naturalHeight, url });
      setPageError("");
    } catch (caught) {
      URL.revokeObjectURL(url);
      setPageError(caught instanceof Error ? caught.message : "图片读取失败，请重新选择");
    }
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void selectFile(event.dataTransfer.files[0]);
  };
  const clearSource = () => {
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    sourceUrlRef.current = "";
    resetOutput();
    setSource(null);
    setPageError("");
    if (inputRef.current) inputRef.current.value = "";
  };
  const upscale = async () => {
    if (!source || processing) return;
    const targetWidth = source.width * scale;
    const targetHeight = source.height * scale;
    if (targetWidth > 10000 || targetHeight > 10000 || targetWidth * targetHeight > 42_000_000) {
      setPageError(`输出尺寸 ${targetWidth} × ${targetHeight} 过大，请选择 2× 或更小的原图`);
      return;
    }
    setProcessing(true);
    setPageError("");
    resetOutput();
    try {
      setProgress(12);
      await nextPaint();
      const image = await loadPreviewImage(source.url);
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("当前浏览器无法处理这张图片");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.filter = mode === "detail" ? "contrast(1.05) saturate(1.03)" : mode === "portrait" ? "contrast(1.015) saturate(1.01) brightness(1.01)" : "contrast(1.025) saturate(1.02)";
      setProgress(38);
      await nextPaint();
      context.drawImage(image, 0, 0, targetWidth, targetHeight);
      setProgress(78);
      await nextPaint();
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("高清图片导出失败")), "image/png"));
      const nextUrl = URL.createObjectURL(blob);
      outputUrlRef.current = nextUrl;
      setOutputUrl(nextUrl);
      setOutputBytes(blob.size);
      setComparison(50);
      setProgress(100);
      onToast("高清图片已生成");
    } catch (caught) {
      setPageError(caught instanceof Error ? caught.message : "高清处理失败，请重新尝试");
      setProgress(0);
    } finally {
      setProcessing(false);
    }
  };
  const downloadResult = () => {
    if (!outputUrl || !source) return;
    const link = document.createElement("a");
    const baseName = source.name.replace(/\.[^.]+$/, "");
    link.href = outputUrl;
    link.download = `${baseName}-${scale}x-HD.png`;
    link.click();
    onToast("高清图片已下载");
  };
  const changeScale = (nextScale: 2 | 4) => { setScale(nextScale); resetOutput(); setPageError(""); };
  const changeMode = (nextMode: UpscaleMode) => { setMode(nextMode); resetOutput(); setPageError(""); };
  const modes: Array<{ id: UpscaleMode; title: string; description: string }> = [
    { id: "balanced", title: "自然清晰", description: "画面均衡，适合多数素材" },
    { id: "detail", title: "细节增强", description: "加强纹理与明暗层次" },
    { id: "portrait", title: "柔和人像", description: "降低锐化感，保留肤质" },
  ];

  return <main className="upscale-content">
    <header className="upscale-head">
      <div><span className="panel-eyebrow">IMAGE UPSCALER</span><h1>一键高清</h1><p>提升图片尺寸与画面清晰度，保留原始构图和色彩。</p></div>
      {source && <button type="button" className="secondary-button upscale-replace" onClick={() => inputRef.current?.click()}><Upload size={15} />更换图片</button>}
    </header>
    <input ref={inputRef} className="upscale-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void selectFile(event.target.files?.[0])} />
    {!source ? <div className={`upscale-dropzone ${dragging ? "dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
      <div className="upscale-drop-icon"><ImagePlus size={28} /></div>
      <strong>上传需要变清晰的图片</strong>
      <span>PNG、JPG、WebP · 最大 20 MB</span>
      <button type="button" className="primary-button" onClick={() => inputRef.current?.click()}><Upload size={16} />选择图片</button>
    </div> : <section className="upscale-workspace">
      <div className="upscale-preview-panel">
        <div className="upscale-preview-toolbar">
          <div><strong>{source.name}</strong><span>{source.width} × {source.height} · {formatFileSize(source.size)}</span></div>
          <button type="button" className="icon-button" aria-label="移除图片" title="移除图片" disabled={processing} onClick={clearSource}><Trash2 size={16} /></button>
        </div>
        <div className="upscale-preview-stage">
          <div className={`upscale-comparison ${outputUrl ? "ready" : ""}`}>
            <img src={source.url} alt="原始图片" />
            {outputUrl && <><img className="upscale-result-layer" src={outputUrl} alt="高清图片" style={{ clipPath: `inset(0 ${100 - comparison}% 0 0)` }} /><span className="upscale-label original">原图</span><span className="upscale-label result">高清</span><div className="upscale-divider" style={{ left: `${comparison}%` }}><span><ArrowLeftRight size={14} /></span></div><input className="upscale-compare-range" aria-label="拖动查看原图与高清图对比" type="range" min="0" max="100" value={comparison} onChange={(event) => setComparison(Number(event.target.value))} /></>}
            {!outputUrl && !processing && <div className="upscale-awaiting"><ScanSearch size={23} /><span>等待高清处理</span></div>}
            {processing && <div className="upscale-processing"><LoaderCircle className="spin" size={25} /><strong>正在提升清晰度</strong><span>{progress}%</span><div><i style={{ width: `${progress}%` }} /></div></div>}
          </div>
        </div>
      </div>
      <aside className="upscale-settings">
        <div className="upscale-settings-head"><div><span>OUTPUT</span><h2>输出设置</h2></div><Settings2 size={18} /></div>
        <section className="upscale-setting-group"><div className="upscale-setting-title"><strong>放大倍数</strong><span>输出尺寸</span></div><div className="upscale-scale-tabs">{([2, 4] as const).map((value) => <button type="button" key={value} className={scale === value ? "selected" : ""} onClick={() => changeScale(value)} disabled={processing}><strong>{value}×</strong><span>{source.width * value} × {source.height * value}</span></button>)}</div></section>
        <section className="upscale-setting-group"><div className="upscale-setting-title"><strong>增强模式</strong><span>画面倾向</span></div><div className="upscale-mode-list">{modes.map((item) => <button type="button" key={item.id} className={mode === item.id ? "selected" : ""} onClick={() => changeMode(item.id)} disabled={processing}><span className="upscale-mode-check">{mode === item.id && <Check size={11} />}</span><span><strong>{item.title}</strong><small>{item.description}</small></span></button>)}</div></section>
        <div className="upscale-output-summary"><div><span>原始尺寸</span><strong>{source.width} × {source.height}</strong></div><ArrowRight size={15} /><div><span>输出尺寸</span><strong>{source.width * scale} × {source.height * scale}</strong></div></div>
        {pageError && <div className="upscale-error">{pageError}</div>}
        <div className="upscale-actions">{outputUrl ? <><button type="button" className="primary-button" onClick={downloadResult}><Download size={16} />下载高清图片</button><button type="button" className="secondary-button" onClick={() => void upscale()}><RefreshCw size={15} />重新处理</button><span>{formatFileSize(outputBytes)} · PNG</span></> : <button type="button" className="primary-button" disabled={processing} onClick={() => void upscale()}>{processing ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{processing ? "正在处理" : "生成高清图片"}</button>}</div>
      </aside>
    </section>}
    {!source && pageError && <div className="upscale-empty-error">{pageError}</div>}
  </main>;
}

type PromptTemplateCategory = "design" | "single-image" | "three-view" | "four-view" | "nine-grid" | "video" | "storyboard";
type PromptTemplate = {
  id: string;
  category: PromptTemplateCategory;
  title: string;
  prompt: string;
};

const promptCategoryOptions: Array<{ id: "all" | PromptTemplateCategory; label: string }> = [
  { id: "all", label: "全部" },
  { id: "design", label: "提示词设计" },
  { id: "single-image", label: "单图" },
  { id: "three-view", label: "三视图" },
  { id: "four-view", label: "四视图" },
  { id: "nine-grid", label: "九宫格" },
  { id: "video", label: "视频提示词" },
  { id: "storyboard", label: "分镜提示词" },
];

const promptCategoryLabels = Object.fromEntries(
  promptCategoryOptions.filter((item) => item.id !== "all").map((item) => [item.id, item.label]),
) as Record<PromptTemplateCategory, string>;

const promptTemplates: PromptTemplate[] = [
  {
    id: "visual-prompt-designer",
    category: "design",
    title: "画面提示词设计器",
    prompt: "你是一名视觉提示词设计师。请把用户的简短想法“[画面想法]”整理成一条可直接用于图像生成的中文提示词。依次明确：核心主体与可见特征、动作或状态、环境与时代、景别与机位、镜头焦段与景深、构图关系、光源方向与光质、主辅色、视觉媒介与质感、画面叙事重点、需要避免的错误。补足有助于画面成立的细节，但不要改变原始主题，不要堆砌同义形容词。只输出最终提示词，不解释设计过程。",
  },
  {
    id: "consistency-prompt-designer",
    category: "design",
    title: "角色一致性强化",
    prompt: "请重写以下提示词，使同一角色在多张图或连续镜头中保持稳定：[原始提示词]。先锁定不可变化的身份锚点：年龄、脸型、五官比例、肤色、发型轮廓、身材比例、固定服装、鞋履、配饰和独特标记；再保留本镜头允许变化的表情、动作、景别、机位和环境。将身份锚点放在提示词前部，并在末尾加入一致性约束与负面要求。不要新增角色设定，不要使用相互冲突的描述。只输出优化后的完整提示词。",
  },
  {
    id: "prompt-refiner",
    category: "design",
    title: "提示词精简优化",
    prompt: "优化以下提示词：[原始提示词]。删除重复、空泛和互相冲突的词语，保留真正影响结果的主体、动作、场景、构图、镜头、光线、色彩、风格和约束。把内容重排为“主体与动作 → 场景 → 镜头与构图 → 光线与色彩 → 材质与风格 → 负面要求”，用准确、可观察的描述替代“高级、好看、震撼”等抽象评价。不要改变用户意图，不添加无关元素。只输出一条精炼、连贯、可直接使用的提示词。",
  },
  {
    id: "negative-constraint-designer",
    category: "design",
    title: "负面约束生成",
    prompt: "根据主提示词“[主提示词]”生成一段针对性的负面约束。优先识别并约束：主体数量错误、身份漂移、五官与肢体畸变、服装或道具变化、空间透视错误、画面裁切、重复元素、文字与水印、低清晰度、过度锐化、塑料质感、闪烁和不符合物理规律的运动。仅保留与当前画面或视频真正相关的项目，避免无意义的通用词堆叠。只输出负面约束文本。",
  },
  {
    id: "cinematic-character",
    category: "single-image",
    title: "电影感角色单图",
    prompt: "[角色名称]，[年龄与身份]，[五官、发型、体态与服装细节]，[神态与动作]，位于[场景]。采用[景别]与[机位]，主体清晰，背景层次分明，[时间与天气]，[主光方向、光质与色温]，电影写实风格，真实皮肤与布料纹理，细腻色彩分级，画面叙事明确，构图平衡，高清细节。保持角色身份和服装特征准确。不要多余人物、文字、水印、畸形肢体、重复五官、过度磨皮和塑料质感。",
  },
  {
    id: "cinematic-environment",
    category: "single-image",
    title: "环境场景单图",
    prompt: "[场景名称]，[空间类型与时代背景]。画面包含[前景元素]、[中景主体]和[远景环境]，明确门窗、通道、固定陈设与材质关系，[时间]，[天气]，[光源位置与氛围]。采用[镜头焦段]的[景别]，[视角高度]，电影级场景概念设计，空间透视准确，材质真实，光影统一，色彩克制，保留可供人物行动的区域。不要人物、文字、水印、漂浮物、错误透视和重复建筑结构。",
  },
  {
    id: "product-hero-image",
    category: "single-image",
    title: "商品主视觉单图",
    prompt: "[商品名称]商业主视觉，商品以[角度]摆放在[台面或环境]中央，完整展示[关键结构、材质、颜色与品牌识别点]，[辅助元素]围绕主体形成层次但不遮挡产品。采用[景别]、[机位]与[镜头焦段]，主体边缘清晰，[主光方向]的[硬光/柔光]塑造材质，[轮廓光或环境反射]分离背景，色彩以[主色]和[辅助色]为主，高级产品摄影，真实反射与阴影，留出[文案留白位置]。不要人物、手、错误文字、变形包装、重复商品、悬浮阴影和过度光晕。",
  },
  {
    id: "key-art-illustration",
    category: "single-image",
    title: "故事概念主视觉",
    prompt: "为“[故事名称]”创作一张叙事主视觉。[主角]位于[场景]，正在[关键动作]，[冲突对象或事件]出现在[画面位置]。采用[近景/中景/全景]和[低机位/平视/俯视]，利用前景遮挡、引导线与大小对比突出叙事焦点，[时间、天气与光线]，[限定的两到三种主色]，风格为[电影写实/国风插画/动画概念设计]，保留真实材质与清晰轮廓。画面只表现一个核心事件，不要标题、文字、水印、无关人物、杂乱背景和错误透视。",
  },
  {
    id: "standard-three-view",
    category: "three-view",
    title: "角色标准三视图",
    prompt: "[角色名称]角色设定三视图，同一张画布从左到右依次展示正面、侧面、背面。角色为[年龄、性别与身份]，[发型与面部特征]，穿着[服装、鞋履与配饰]。三个视图保持同一人物、同一服装、同一发型，严格等高等比例，全身完整，站姿自然，双臂略微离开身体，细节清晰可辨。纯色中性背景，均匀柔光，无透视夸张。不要文字、标注线、道具、场景、动作变化、裁切、重复人物或不同服装。",
  },
  {
    id: "prop-three-view",
    category: "three-view",
    title: "道具标准三视图",
    prompt: "[道具名称]标准三视图，同一张画布从左到右展示正面、侧面、背面。道具的用途为[用途]，尺寸为[尺寸]，采用[主要材质]，[颜色与表面状态]，具有[关键结构与识别细节]。三个视图严格等比例、等高，轮廓、接口、纹理、磨损和装饰位置准确对应，正交视角，物体完整不裁切，纯净中性背景，均匀棚拍光。不要人物、手、场景、文字、尺寸标注、透视夸张、结构变化或额外零件。",
  },
  {
    id: "costume-three-view",
    category: "three-view",
    title: "服装设计三视图",
    prompt: "[角色身份]的[服装名称]设计三视图，同一张画布展示正面、侧面、背面。服装包含[上装、下装、外套、鞋履与配饰]，主材质为[材质]，配色为[主色、辅助色]，剪裁与时代为[版型与时代]，关键纹样位于[位置]。三个视图使用同一中性人体模特，等高等比例，布料结构、接缝、纹样、开合方式和配饰位置完全一致，均匀光线，纯净背景。不要改变体型、姿势和服装层级，不要文字、场景、裁切或不同款式。",
  },
  {
    id: "scene-three-view",
    category: "three-view",
    title: "场景空间三视图",
    prompt: "[场景名称]空间设定三视图，同一张画布依次展示入口视角、正向全景、反向全景。场景为[空间类型与时代]，包含[门窗、通道、家具和固定陈设]，材质为[主要材质]，[时间与天气]，[光源位置]。三个视图必须呈现同一空间，门窗、出入口、尺度、陈设位置和光源方向准确对应，广角但无明显畸变，空置无人，画面清晰。不要人物、文字、漂浮物、重复门窗、空间重构、错误透视和视角间布局冲突。",
  },
  {
    id: "standard-four-view",
    category: "four-view",
    title: "角色标准四视图",
    prompt: "[角色名称]角色设定四视图，同一张画布从左到右依次展示正面、左侧、背面、右侧。角色为[年龄、性别与身份]，[稳定的脸型、发型、体态与识别特征]，穿着[服装、鞋履与配饰]。四个视图必须为同一人物，严格等高等比例，头身比、服装结构、纹样位置和配饰完全一致，全身从头顶到鞋底完整呈现，标准站姿，中性表情。纯净背景，均匀棚拍光。不要额外人物、文字、拼贴边框、场景、动作变化、裁切和结构错位。",
  },
  {
    id: "prop-four-view",
    category: "four-view",
    title: "道具结构四视图",
    prompt: "[道具名称]产品设定四视图，同一张画布依次展示正面、左侧、背面、右侧。道具尺寸为[尺寸]，主体材质为[材质]，颜色与表面状态为[颜色、纹理、磨损程度]，包含[接口、按钮、开合件或独特结构]。四个视图严格等比例，轮廓、结构、纹理、接口和装饰位置彼此对应，物体完整不裁切，正交视角，纯净中性背景，柔和均匀光线，高清工业设计细节。不要人物、手、使用场景、文字、尺寸线、透视畸变或额外零件。",
  },
  {
    id: "scene-four-view",
    category: "four-view",
    title: "场景结构四视图",
    prompt: "[场景名称]四视图设定，同一张画布依次展示入口视角、正向全景、反向全景、侧向全景。场景为[空间类型]，核心区域包括[区域 A、区域 B、出入口和固定陈设]，主要材质为[材质]，[时间、天气和照明]。四个视图保持建筑结构、空间尺度、门窗、动线、家具位置和光源方向完全一致，镜头高度统一，透视准确，画面空置无人。不要人物、文字、镜像布局、重复结构、漂浮物、广角弯曲和视角之间的陈设变化。",
  },
  {
    id: "vehicle-four-view",
    category: "four-view",
    title: "载具工业四视图",
    prompt: "[载具名称]工业设计四视图，同一张画布从左到右展示正面、左侧、背面、右侧。载具属于[类型与时代]，整体尺寸与比例为[规格]，车身采用[材质与配色]，具有[灯组、轮组、舱门、接口和独特结构]。四个视图严格等比例、等高，车身轮廓、轴距、结构分缝、纹样和磨损位置准确对应，正交视角，完整不裁切，纯净背景，柔和棚拍光。不要驾驶员、环境、文字、品牌变形、轮组错位、结构增减或透视夸张。",
  },
  {
    id: "action-nine-grid",
    category: "nine-grid",
    title: "角色动作九宫格",
    prompt: "[角色名称]动作设计九宫格，在同一张画布中以规整的 3×3 网格展示九个连续或独立动作：1.[动作一]；2.[动作二]；3.[动作三]；4.[动作四]；5.[动作五]；6.[动作六]；7.[动作七]；8.[动作八]；9.[动作九]。九格始终保持同一角色的脸型、发型、服装、配饰和身体比例一致，每格人物全身完整，动作轮廓清晰，视角与光线统一，纯净背景。不要文字编号、额外人物、服装变化、肢体粘连、重复姿势、裁切或跨格元素。",
  },
  {
    id: "expression-nine-grid",
    category: "nine-grid",
    title: "角色表情九宫格",
    prompt: "[角色名称]表情设定九宫格，同一张画布以规整的 3×3 网格展示：平静、喜悦、悲伤、愤怒、惊讶、恐惧、怀疑、疲惫、坚定。统一正面胸像机位，人物脸型、五官、发型、服装、配饰、光线和背景完全一致，仅改变自然且克制的表情与眼神，面部肌肉变化真实，角色辨识度稳定，高清细节。不要文字、编号、夸张漫画符号、不同人物、服装变化、五官漂移或跨格元素。",
  },
  {
    id: "shot-language-nine-grid",
    category: "nine-grid",
    title: "电影镜头九宫格",
    prompt: "围绕同一场景“[场景与事件]”制作电影镜头九宫格。九格依次为：建立全景、中全景、双人中景、角色近景、眼神特写、关键道具特写、低机位镜头、过肩镜头、结尾远景。保持同一角色外貌与服装、同一空间结构、同一时间和光线方向，遵守轴线与视线关系；每格构图明确、景别差异清晰，共同讲述一个连续事件，统一[视觉风格与色彩]。不要文字编号、时间跳跃、角色或道具漂移、重复构图、跨格元素和无关人物。",
  },
  {
    id: "lighting-nine-grid",
    category: "nine-grid",
    title: "场景光线九宫格",
    prompt: "[场景名称]光线测试九宫格，同一固定机位、同一空间结构与陈设，分别展示：清晨冷光、正午硬光、阴天漫射光、黄昏逆光、蓝调时刻、夜间月光、室内暖灯、霓虹混合光、紧急红色警示光。九格只改变时间、光源与色彩氛围，建筑材质、物体位置、镜头焦段和构图完全一致，明暗层次真实，光线来源可解释。不要人物、文字、布局变化、物体增减、过曝、死黑、漂浮光源和跨格元素。",
  },
  {
    id: "cinematic-video-shot",
    category: "video",
    title: "电影叙事镜头",
    prompt: "[时长]秒，[画幅]。镜头从[起始画面与景别]开始，[角色名称]在[场景]中[动作]，[环境中的同步变化]。摄影机以[推、拉、摇、移、跟、环绕或手持]方式[运动路径]，焦点从[焦点 A]平滑转移到[焦点 B]，最终停在[结束构图]。保持角色外貌、服装、场景结构与光源方向前后一致，[时间与天气]，[光影与色彩氛围]，动作符合真实物理惯性，节奏[缓慢/紧张/利落]，电影级运动模糊与景深。不要镜头跳切、人物变形、身份漂移、服装变化、闪烁、物体凭空出现、文字和水印。",
  },
  {
    id: "first-last-frame",
    category: "video",
    title: "首尾帧过渡镜头",
    prompt: "以首帧中的[主体、姿态、场景与构图]为起点，通过[角色动作或环境事件]自然过渡到尾帧中的[主体状态、场景与构图]。镜头采用[运镜方式]，沿[运动方向与路径]平稳移动；在[关键时间点]发生[关键变化]，过渡过程连续、可解释，没有突变。严格保持角色脸型、发型、服装、道具和空间结构一致，光线从[首帧光线]自然变化为[尾帧光线]，运动速度与物理反馈真实。不要硬切、闪烁、画面溶解、主体复制、五官漂移、肢体畸变、背景重构、文字和水印。",
  },
  {
    id: "emotion-close-up-video",
    category: "video",
    title: "情绪特写镜头",
    prompt: "[时长]秒单镜头。[角色名称]位于[场景]，保持[起始表情与姿态]，听到或看到[触发事件]后，眼神先[细微变化]，随后[嘴角、眉眼或呼吸的变化]，最终呈现[结束情绪]。摄影机使用[焦段]近景，从[起始机位]缓慢[推进/侧移]至面部特写，焦点稳定落在眼睛，背景柔和虚化。[光源方向与色温]，保留真实皮肤纹理和细微呼吸。保持身份、发型、服装与背景连续。不要夸张表演、口型乱动、五官漂移、皮肤闪烁、突然转头、镜头跳切、文字和水印。",
  },
  {
    id: "product-reveal-video",
    category: "video",
    title: "商品展示镜头",
    prompt: "[时长]秒，[画幅]。[商品名称]置于[台面与环境]，起始画面为[局部特写或剪影]。摄影机沿[弧形/直线/升降]路径平稳运动，[商品或台面]以[速度]缓慢旋转，依次显露[材质细节、关键结构与品牌识别点]，最终停在完整三分之四视角。[主光]扫过表面形成真实高光，[辅光与轮廓光]保持边缘清晰，背景元素仅做轻微运动，节奏干净克制。不要商品变形、文字错乱、部件增减、镜面穿帮、悬浮、抖动、闪烁、快速切镜和多余物体。",
  },
  {
    id: "story-scene-board",
    category: "storyboard",
    title: "剧情场景分镜",
    prompt: "将以下剧情拆成[镜头数量]个连续分镜：[粘贴剧情]。每个分镜依次输出：镜头编号、景别、机位与焦段、画面主体、角色动作与表情、场景与光线、摄影机运动、对白或声音、建议时长。分镜需遵循建立空间—推进冲突—突出反应—完成转折的叙事顺序，轴线与视线方向一致，相邻镜头景别有变化，角色位置、服装、道具和时间连续。只输出结构化分镜内容，不添加剧情中不存在的人物、事件或台词。",
  },
  {
    id: "continuous-action-board",
    category: "storyboard",
    title: "连续动作分镜",
    prompt: "围绕动作事件“[核心动作]”设计[镜头数量]个连续分镜，角色为[角色名称]，场景为[场景]。将动作拆分为准备、启动、发展、关键接触、结果和反应，明确每个镜头的景别、机位、主体位置、动作起止姿态、运动方向、摄影机运动和时长。前一镜头的结束姿态必须与后一镜头的开始姿态衔接，遵守 180 度轴线、视线匹配和动作匹配，保持角色、服装、道具、场景与光线连续。只输出可执行的分镜提示词，不省略动作节点，不加入无关旁白。",
  },
  {
    id: "dialogue-storyboard",
    category: "storyboard",
    title: "双人对白分镜",
    prompt: "将以下双人对白设计为[镜头数量]个连续分镜：[粘贴对白与动作]。角色 A 位于[位置]，角色 B 位于[位置]，先建立两人的空间关系与视线轴线，再按情绪变化安排双人镜头、正反打、过肩镜头、反应特写和必要的空镜。每个镜头输出：编号、景别、机位、画面内容、说话者与台词、非说话者反应、运镜、声音和时长。保持视线方向、角色站位、服装、道具和环境连续，重要反应优先于机械切换说话者。不要越轴、跳轴、漏掉关键反应、添加原文没有的台词或滥用无意义特写。",
  },
  {
    id: "short-ad-storyboard",
    category: "storyboard",
    title: "短视频广告分镜",
    prompt: "为[商品或服务]设计一支[总时长]秒、[画幅]的短视频广告，核心卖点为[卖点]，目标观众为[人群]，行动目标为[购买/了解/预约]。分镜结构：前 3 秒用[冲突或视觉钩子]吸引注意；中段展示[使用场景、功能证据与差异点]；结尾给出[产品主视觉与行动信息]。每个镜头输出编号、时长、景别、画面动作、镜头运动、画面文字、旁白/对白、音效与转场。控制信息密度，产品外观与品牌色一致，转场由动作或构图驱动。不要虚构无法证明的效果、冗长旁白、无关人物、品牌文字变形和连续性错误。",
  },
];

function PromptWorkshop({ onToast }: { onToast: (message: string) => void }) {
  const [category, setCategory] = useState<"all" | PromptTemplateCategory>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(promptTemplates[0].id);
  const [draft, setDraft] = useState(promptTemplates[0].prompt);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const selectedTemplate = promptTemplates.find((item) => item.id === selectedId) ?? promptTemplates[0];
  const filteredTemplates = useMemo(() => promptTemplates.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (!normalizedQuery) return true;
    return [item.title, item.prompt, promptCategoryLabels[item.category]].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  }), [category, normalizedQuery]);

  const selectTemplate = (template: PromptTemplate) => {
    setSelectedId(template.id);
    setDraft(template.prompt);
  };
  const selectCategory = (nextCategory: "all" | PromptTemplateCategory) => {
    setCategory(nextCategory);
    const nextTemplate = promptTemplates.find((item) => (nextCategory === "all" || item.category === nextCategory)
      && (!normalizedQuery || [item.title, item.prompt, promptCategoryLabels[item.category]].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))));
    if (nextTemplate) selectTemplate(nextTemplate);
  };
  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      onToast("提示词已复制");
    } catch {
      onToast("复制失败，请手动选择提示词");
    }
  };

  return <main className="prompt-workshop-content">
    <header className="prompt-workshop-head">
      <div><span className="panel-eyebrow">PROMPT WORKSHOP</span><h1>提示词工坊</h1><p>为单图、多视图、视频与分镜整理可直接改写的提示词模板。</p></div>
      <span className="prompt-template-count"><strong>{promptTemplates.length}</strong> 个模板</span>
    </header>
    <div className="prompt-workshop-toolbar">
      <label className="prompt-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提示词模板" aria-label="搜索提示词模板" />{query && <button type="button" onClick={() => setQuery("")} aria-label="清空搜索" title="清空搜索"><X size={15} /></button>}</label>
      <div className="prompt-category-tabs" role="tablist" aria-label="提示词类型">{promptCategoryOptions.map((item) => { const count = item.id === "all" ? promptTemplates.length : promptTemplates.filter((template) => template.category === item.id).length; return <button type="button" role="tab" aria-selected={category === item.id} key={item.id} className={category === item.id ? "selected" : ""} onClick={() => selectCategory(item.id)}>{item.label}<span>{count}</span></button>; })}</div>
    </div>
    <section className="prompt-workshop-layout">
      <aside className="prompt-template-panel">
        <div className="prompt-panel-title"><strong>模板库</strong><span>{filteredTemplates.length} 项</span></div>
        {filteredTemplates.length ? <div className="prompt-template-list">{filteredTemplates.map((template) => <button type="button" key={template.id} className={selectedId === template.id ? "selected" : ""} onClick={() => selectTemplate(template)}><span>{promptCategoryLabels[template.category]}</span><strong>{template.title}</strong><p>{template.prompt}</p></button>)}</div> : <div className="prompt-template-empty"><Search size={20} /><strong>没有匹配的模板</strong><span>换个关键词或分类试试</span></div>}
      </aside>
      <section className="prompt-editor">
        <div className="prompt-editor-head">
          <div><span>{promptCategoryLabels[selectedTemplate.category]}</span><h2>{selectedTemplate.title}</h2></div>
          <div className="prompt-editor-actions"><button type="button" className="icon-button" onClick={() => setDraft(selectedTemplate.prompt)} disabled={draft === selectedTemplate.prompt} aria-label="恢复模板原文" title="恢复模板原文"><RefreshCw size={16} /></button><button type="button" className="primary-button prompt-copy-button" onClick={() => void copyPrompt()} disabled={!draft.trim()}><Copy size={16} />复制提示词</button></div>
        </div>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={`${selectedTemplate.title}提示词`} spellCheck={false} />
        <div className="prompt-editor-foot"><span>{draft === selectedTemplate.prompt ? "模板原文" : "已修改"}</span><small>{draft.length} 字</small></div>
      </section>
    </section>
  </main>;
}

function CharacterStudio({ assetType, imageSettings, onConfigure, onToast }: { assetType: StudioAssetType; imageSettings: ImageSettings | null; onConfigure: () => void; onToast: (message: string) => void }) {
  const config = studioAssetConfig[assetType];
  const [draft, setDraft] = useState<CharacterStudioDraft>({ name: "", description: "", referenceName: "", style: "电影写实", model: imageModelOptions[0], resolution: "2K", aspectRatio: config.defaultRatio, watermark: false });
  const [results, setResults] = useState<CharacterImageResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [pageError, setPageError] = useState("");

  useEffect(() => {
    let active = true;
    void api.assetImages(assetType)
      .then((items) => {
        if (!active) return;
        setResults(items);
        setSelectedId(items[0]?.id ?? null);
      })
      .catch((caught) => { if (active) setPageError(caught instanceof Error ? caught.message : "生成记录读取失败"); })
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [assetType]);

  useEffect(() => {
    if (imageSettings?.model) setDraft((current) => ({ ...current, model: imageSettings.model }));
  }, [imageSettings?.model]);

  const selected = results.find((item) => item.id === selectedId) ?? results[0] ?? null;
  const ready = Boolean(imageSettings?.configured && draft.name.trim() && draft.description.trim().length >= 8 && draft.model.trim());
  const modelOptions = Array.from(new Set([imageSettings?.model, draft.model, ...imageModelOptions].filter(Boolean) as string[])).map((value) => ({ value, label: value }));
  const change = <K extends keyof CharacterStudioDraft>(key: K, value: CharacterStudioDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const selectReference = (file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setPageError("请选择 PNG、JPG 或 WebP 图片"); return; }
    if (file.size > 8 * 1024 * 1024) { setPageError("参考图不能超过 8MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      setDraft((current) => ({ ...current, referenceImage: String(reader.result ?? ""), referenceName: file.name }));
      setPageError("");
    };
    reader.onerror = () => setPageError("参考图读取失败，请重新选择");
    reader.readAsDataURL(file);
  };
  const generate = async () => {
    if (generating) return;
    if (!imageSettings?.configured) { onConfigure(); return; }
    if (!ready) { setPageError(`请填写${config.nameLabel}，并至少用 8 个字补充${config.descriptionLabel}`); return; }
    setGenerating(true);
    setPageError("");
    const prompt = [
      `${config.nameLabel}：${draft.name.trim()}`,
      `${config.descriptionLabel}：${draft.description.trim()}`,
      `视觉风格：${draft.style}`,
      `生成要求：${config.requirement}`,
      draft.watermark ? "水印要求：允许图片平台添加水印。" : "水印要求：画面中不要出现任何水印。",
    ].join("\n");
    try {
      const result = await api.generateAssetImage(assetType, { prompt, model: draft.model.trim(), resolution: draft.resolution, aspectRatio: draft.aspectRatio, referenceImage: draft.referenceImage, watermark: draft.watermark });
      setResults((current) => [result, ...current.filter((item) => item.id !== result.id)]);
      setSelectedId(result.id);
      onToast(`“${draft.name.trim()}”已生成并保存到本地`);
    } catch (caught) {
      setPageError(caught instanceof Error ? caught.message : `${config.title}失败`);
    } finally {
      setGenerating(false);
    }
  };

  return <main className="character-studio-content">
    <header className="character-studio-head">
      <div><span className="panel-eyebrow">{config.englishTitle}</span><h1>{config.title}</h1><p>{config.description}</p></div>
      <span className={`character-config-state ${imageSettings?.configured ? "configured" : ""}`}><i />{imageSettings?.configured ? "图片模型已连接" : "图片模型未配置"}</span>
    </header>
    <div className="character-studio-layout">
      <section className="character-controls" aria-label={`${config.title}参数`}>
        <div className="character-section-title"><span>生成参数</span><small>01 / INPUT</small></div>
        <label className="character-field"><span>{config.nameLabel}</span><input value={draft.name} maxLength={40} onChange={(event) => change("name", event.target.value)} placeholder={config.namePlaceholder} /></label>
        <div className="character-field character-prompt-field"><div className="character-field-label"><span>{config.descriptionLabel}</span><button type="button" className="character-example-button" onClick={() => setDraft((current) => ({ ...current, name: config.exampleName, description: config.examplePrompt }))}><Sparkles size={13} />四视图示例</button></div><textarea aria-label={config.descriptionLabel} value={draft.description} maxLength={1200} onChange={(event) => change("description", event.target.value)} placeholder={config.descriptionPlaceholder} /><small>{draft.description.length} / 1200</small></div>
        <div className="character-field character-reference-field">
          <span>参考图</span>
          <div className="character-reference-row">
            <div className="character-reference-tile">
              <label className={`character-reference-picker ${draft.referenceImage ? "has-preview" : ""}`} title={draft.referenceImage ? `更换参考图：${draft.referenceName}` : "添加参考图，支持 PNG、JPG、WebP，最大 8MB"}>
                <input type="file" accept="image/png,image/jpeg,image/webp" disabled={generating} onChange={(event) => { selectReference(event.target.files?.[0]); event.target.value = ""; }} />
                {draft.referenceImage ? <img src={draft.referenceImage} alt="参考图预览" /> : <><Plus size={19} /><strong>{config.nameLabel.replace("名称", "图片")}</strong></>}
              </label>
              {draft.referenceImage && <button type="button" className="character-reference-remove" disabled={generating} onClick={() => setDraft((current) => ({ ...current, referenceImage: undefined, referenceName: "" }))} aria-label="移除参考图" title="移除参考图"><X size={12} /></button>}
            </div>
          </div>
        </div>
        <div className="character-field"><span>视觉风格</span><SmoothSelect value={draft.style} onChange={(value) => change("style", value)} ariaLabel="视觉风格" options={["电影写实", "胶片人像", "日系动画", "国风水墨", "赛博电影", "3D 渲染"].map((value) => ({ value, label: value }))} /></div>
        <div className="character-parameter-row">
          <div className="character-field"><span>画面比例</span><SmoothSelect value={draft.aspectRatio} onChange={(value) => change("aspectRatio", value as ImageAspectRatio)} ariaLabel="画面比例" options={imageRatioOptions} /></div>
          <div className="character-field"><span>分辨率</span><SmoothSelect value={draft.resolution} onChange={(value) => change("resolution", value as ImageResolution)} ariaLabel="分辨率" options={[{ value: "2K", label: "2K" }, { value: "4K", label: "4K" }]} /></div>
        </div>
        <div className="character-field"><span>图片模型</span><SmoothSelect value={draft.model} onChange={(value) => change("model", value)} ariaLabel="图片模型" options={modelOptions} /></div>
        <button type="button" className={`video-toggle character-watermark-toggle ${draft.watermark ? "on" : ""}`} onClick={() => change("watermark", !draft.watermark)} aria-pressed={draft.watermark}><span>添加水印</span><i /></button>
        {pageError && <div className="character-error" role="alert">{pageError}</div>}
        {!imageSettings?.configured ? <button type="button" className="primary-button character-generate" onClick={onConfigure}><Settings2 size={17} />前往模型设置</button> : <button type="button" className="primary-button character-generate" onClick={() => void generate()} disabled={!ready || generating}>{generating ? <LoaderCircle className="spin" size={18} /> : <WandSparkles size={18} />}{generating ? `正在${config.title}` : config.title}</button>}
      </section>
      <section className="character-results" aria-label={`${config.title}结果`}>
        <div className="character-section-title"><span>生成结果</span><small>{results.length ? `${results.length} 张已保存` : "02 / OUTPUT"}</small></div>
        <div className="character-results-body">
          <div className={`character-preview ${generating ? "is-generating" : ""}`}>
            {selected ? <img src={selected.imageUrl} alt={`已生成的${config.nameLabel.replace("名称", "")}`} /> : <div className="character-empty">{historyLoading ? <><LoaderCircle className="spin" size={26} /><strong>正在读取本地作品</strong></> : <><ImagePlus size={31} /><strong>生成结果会显示在这里</strong><span>填写左侧参数，创建第一张四视图设定图</span></>}</div>}
            {generating && <div className="character-generating"><LoaderCircle className="spin" size={28} /><strong>正在生成四视图</strong><span>生成完成后会自动保存并显示</span></div>}
            {selected && !generating && <div className="character-preview-actions"><span>{selected.size || imageSizeLabels[draft.resolution][draft.aspectRatio]}</span><a className="icon-button" href={selected.imageUrl} download={`${assetType}-${selected.id}`} aria-label="下载生成图片" title="下载生成图片"><Download size={17} /></a></div>}
          </div>
          <aside className="character-history" aria-label="最近生成"><div><strong>最近生成</strong><span>{results.length ? `${results.length} 张` : "暂无记录"}</span></div>{results.length ? <div className="character-history-strip">{results.map((item, index) => <button type="button" key={item.id} className={item.id === selected?.id ? "selected" : ""} onClick={() => setSelectedId(item.id)} aria-label={`查看第 ${index + 1} 张图片`}><img src={item.imageUrl} alt="" /><span>{String(index + 1).padStart(2, "0")}</span></button>)}</div> : <div className="character-history-empty"><ImagePlus size={18} /><span>生成后显示</span></div>}</aside>
        </div>
      </section>
    </div>
  </main>;
}

type VideoUploadItem = { id: string; name: string; dataUrl: string };
type VideoToolDraft = {
  prompt: string;
  model: VideoSettings["model"];
  ratio: "16:9" | "9:16" | "1:1";
  duration: number;
  generateAudio: boolean;
  watermark: boolean;
};

const studioVideoConfig: Record<StudioVideoType, { title: string; englishTitle: string; description: string; placeholder: string; example: string }> = {
  "reference-video": {
    title: "参考生视频", englishTitle: "REFERENCE VIDEO", description: "通过一至三张参考图锁定人物、物品或场景特征，生成结果自动保存在本地。",
    placeholder: "描述主体动作、镜头运动、环境变化、光线和节奏",
    example: "镜头缓慢向前推进，人物抬头看向窗外，衣角被风轻轻吹动。雨滴沿玻璃滑落，远处霓虹在湿润街道上形成自然倒影，电影级写实光影，动作连续稳定。",
  },
  "keyframe-video": {
    title: "首尾帧视频", englishTitle: "KEYFRAME VIDEO", description: "指定开场画面与可选结束画面，让镜头运动和动作变化拥有明确起点与落点。",
    placeholder: "描述首帧到尾帧之间发生的动作、镜头路径与氛围变化",
    example: "从首帧构图开始，镜头平稳环绕主体向右移动，人物缓慢转身并走向光源，环境光从冷蓝逐渐过渡为暖金，最终自然衔接至尾帧构图，无跳切。",
  },
};

function readVideoImage(file: File) {
  return new Promise<VideoUploadItem>((resolveFile, rejectFile) => {
    const reader = new FileReader();
    reader.onload = () => resolveFile({ id: `${file.name}-${file.lastModified}-${Math.random()}`, name: file.name, dataUrl: String(reader.result ?? "") });
    reader.onerror = () => rejectFile(new Error("图片读取失败，请重新选择"));
    reader.readAsDataURL(file);
  });
}

function VideoToolStudio({ videoType, videoSettings, onConfigure, onToast }: { videoType: StudioVideoType; videoSettings: VideoSettings | null; onConfigure: () => void; onToast: (message: string) => void }) {
  const config = studioVideoConfig[videoType];
  const [draft, setDraft] = useState<VideoToolDraft>({ prompt: "", model: videoSettings?.model ?? videoModelOptions[0], ratio: "16:9", duration: 5, generateAudio: true, watermark: false });
  const [references, setReferences] = useState<VideoUploadItem[]>([]);
  const [firstFrame, setFirstFrame] = useState<VideoUploadItem | null>(null);
  const [lastFrame, setLastFrame] = useState<VideoUploadItem | null>(null);
  const [results, setResults] = useState<StudioVideoResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState("");

  useEffect(() => {
    let active = true;
    void api.studioVideos(videoType).then((items) => {
      if (!active) return;
      setResults(items);
      setSelectedId(items[0]?.id ?? null);
    }).catch((caught) => { if (active) setPageError(caught instanceof Error ? caught.message : "生成记录读取失败"); })
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [videoType]);

  useEffect(() => {
    if (videoSettings?.model) setDraft((current) => ({ ...current, model: videoSettings.model }));
  }, [videoSettings?.model]);

  const pendingKey = results.filter((item) => item.status === "queued" || item.status === "processing").map((item) => item.id).join(",");
  useEffect(() => {
    const ids = pendingKey ? pendingKey.split(",") : [];
    if (!ids.length) return;
    let active = true;
    const refreshPending = async () => {
      const settled = await Promise.all(ids.map((id) => api.studioVideo(videoType, id).catch(() => null)));
      if (!active) return;
      setResults((current) => current.map((item) => settled.find((next) => next?.id === item.id) ?? item));
    };
    const timer = window.setInterval(() => void refreshPending(), 3500);
    void refreshPending();
    return () => { active = false; window.clearInterval(timer); };
  }, [pendingKey, videoType]);

  const selected = results.find((item) => item.id === selectedId) ?? results[0] ?? null;
  const hasRequiredMedia = videoType === "reference-video" ? references.length > 0 : Boolean(firstFrame);
  const ready = Boolean(videoSettings?.configured && draft.prompt.trim().length >= 10 && hasRequiredMedia && !submitting);
  const change = <K extends keyof VideoToolDraft>(key: K, value: VideoToolDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const modelOptions = Array.from(new Set([videoSettings?.model, draft.model, ...videoModelOptions].filter(Boolean) as VideoSettings["model"][])).map((value) => ({ value, label: videoModelLabels[value] }));

  const validateFiles = (files: File[]) => {
    const invalid = files.find((file) => !["image/png", "image/jpeg", "image/webp"].includes(file.type));
    if (invalid) { setPageError("请选择 PNG、JPG 或 WebP 图片"); return false; }
    const oversized = files.find((file) => file.size > 4 * 1024 * 1024);
    if (oversized) { setPageError("单张图片不能超过 4MB"); return false; }
    return true;
  };
  const addReferences = async (files: File[]) => {
    const available = Math.max(0, 3 - references.length);
    const accepted = files.slice(0, available);
    if (!accepted.length || !validateFiles(accepted)) return;
    try { const items = await Promise.all(accepted.map(readVideoImage)); setReferences((current) => [...current, ...items].slice(0, 3)); setPageError(""); }
    catch (caught) { setPageError(caught instanceof Error ? caught.message : "图片读取失败"); }
  };
  const replaceReference = async (id: string, file: File | undefined) => {
    if (!file || !validateFiles([file])) return;
    try { const item = await readVideoImage(file); setReferences((current) => current.map((value) => value.id === id ? item : value)); setPageError(""); }
    catch (caught) { setPageError(caught instanceof Error ? caught.message : "图片读取失败"); }
  };
  const setFrame = async (kind: "first" | "last", file: File | undefined) => {
    if (!file || !validateFiles([file])) return;
    try { const item = await readVideoImage(file); kind === "first" ? setFirstFrame(item) : setLastFrame(item); setPageError(""); }
    catch (caught) { setPageError(caught instanceof Error ? caught.message : "图片读取失败"); }
  };
  const generate = async () => {
    if (!videoSettings?.configured) { onConfigure(); return; }
    if (!hasRequiredMedia) { setPageError(videoType === "reference-video" ? "请至少添加一张参考图" : "请添加首帧图片"); return; }
    if (draft.prompt.trim().length < 10) { setPageError("视频提示词至少需要 10 个字"); return; }
    setSubmitting(true);
    setPageError("");
    try {
      const result = await api.generateStudioVideo(videoType, {
        prompt: draft.prompt.trim(), model: draft.model, ratio: draft.ratio, duration: draft.duration,
        generateAudio: draft.generateAudio, watermark: draft.watermark,
        referenceImages: videoType === "reference-video" ? references.map((item) => item.dataUrl) : undefined,
        firstFrame: videoType === "keyframe-video" ? firstFrame?.dataUrl : undefined,
        lastFrame: videoType === "keyframe-video" ? lastFrame?.dataUrl : undefined,
      });
      setResults((current) => [result, ...current.filter((item) => item.id !== result.id)]);
      setSelectedId(result.id);
      onToast("视频任务已提交，完成后会自动保存到本地");
    } catch (caught) {
      setPageError(caught instanceof Error ? caught.message : "视频任务提交失败");
    } finally { setSubmitting(false); }
  };

  const uploadTile = (item: VideoUploadItem | null, label: string, onFile: (file: File | undefined) => void, onRemove: () => void, required = false) => <div className="studio-video-upload-wrap">
    <label className={`studio-video-upload ${item ? "has-preview" : ""}`} title={item ? `更换${label}` : `上传${label}`}>
      <input type="file" accept="image/png,image/jpeg,image/webp" disabled={submitting} onChange={(event) => { onFile(event.target.files?.[0]); event.target.value = ""; }} />
      {item ? <img src={item.dataUrl} alt={`${label}预览`} /> : <><ImagePlus size={19} /><strong>{label}{required ? " *" : ""}</strong><small>PNG / JPG / WebP</small></>}
    </label>
    {item && <button type="button" className="character-reference-remove" onClick={onRemove} aria-label={`移除${label}`} title={`移除${label}`}><X size={12} /></button>}
  </div>;

  return <main className="character-studio-content video-tool-content">
    <header className="character-studio-head">
      <div><span className="panel-eyebrow">{config.englishTitle}</span><h1>{config.title}</h1><p>{config.description}</p></div>
      <span className={`character-config-state ${videoSettings?.configured ? "configured" : ""}`}><i />{videoSettings?.configured ? "视频模型已连接" : "视频模型未配置"}</span>
    </header>
    <div className="character-studio-layout video-tool-layout">
      <section className="character-controls video-tool-controls" aria-label={`${config.title}参数`}>
        <div className="character-section-title"><span>生成参数</span><small>01 / INPUT</small></div>
        <div className="character-field studio-video-media-field"><span>{videoType === "reference-video" ? "参考图" : "关键帧"}</span>
          {videoType === "reference-video" ? <div className="studio-video-reference-list">
            {references.map((item) => uploadTile(item, "参考图", (file) => void replaceReference(item.id, file), () => setReferences((current) => current.filter((value) => value.id !== item.id))))}
            {references.length < 3 && <label className="studio-video-upload studio-video-add"><input type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={submitting} onChange={(event) => { void addReferences(Array.from(event.target.files ?? [])); event.target.value = ""; }} /><Plus size={20} /><strong>添加参考图</strong><small>{references.length} / 3</small></label>}
          </div> : <div className="studio-video-frame-row">{uploadTile(firstFrame, "首帧", (file) => void setFrame("first", file), () => setFirstFrame(null), true)}<span className="studio-video-frame-link"><ArrowRight size={17} /></span>{uploadTile(lastFrame, "尾帧", (file) => void setFrame("last", file), () => setLastFrame(null))}</div>}
        </div>
        <div className="character-field character-prompt-field"><div className="character-field-label"><span>视频提示词</span><button type="button" className="character-example-button" onClick={() => change("prompt", config.example)}><Sparkles size={13} />使用示例</button></div><textarea value={draft.prompt} maxLength={16000} onChange={(event) => change("prompt", event.target.value)} placeholder={config.placeholder} /><small>{draft.prompt.length} / 16000</small></div>
        <div className="character-field"><span>视频模型</span><SmoothSelect value={draft.model} onChange={(value) => change("model", value as VideoSettings["model"])} ariaLabel="视频模型" options={modelOptions} /></div>
        <div className="studio-video-parameter-row"><div className="character-field"><span>画面比例</span><SmoothSelect value={draft.ratio} onChange={(value) => change("ratio", value as VideoToolDraft["ratio"])} ariaLabel="视频画面比例" options={[{ value: "16:9", label: "16:9 · 横屏" }, { value: "9:16", label: "9:16 · 竖屏" }, { value: "1:1", label: "1:1 · 方形" }]} /></div><div className="character-field"><span>视频时长</span><SmoothSelect value={String(draft.duration)} onChange={(value) => change("duration", Number(value))} ariaLabel="视频时长" options={[4, 5, 6, 8, 10, 12].map((value) => ({ value: String(value), label: `${value} 秒` }))} /></div></div>
        <div className="studio-video-toggle-row"><button type="button" className={`video-toggle ${draft.generateAudio ? "on" : ""}`} onClick={() => change("generateAudio", !draft.generateAudio)} aria-pressed={draft.generateAudio}><span>生成声音</span><i /></button><button type="button" className={`video-toggle ${draft.watermark ? "on" : ""}`} onClick={() => change("watermark", !draft.watermark)} aria-pressed={draft.watermark}><span>添加水印</span><i /></button></div>
        {pageError && <div className="character-error" role="alert">{pageError}</div>}
        {!videoSettings?.configured ? <button type="button" className="primary-button character-generate" onClick={onConfigure}><Settings2 size={17} />前往模型设置</button> : <button type="button" className="primary-button character-generate" onClick={() => void generate()} disabled={!ready}>{submitting ? <LoaderCircle className="spin" size={18} /> : <WandSparkles size={18} />}{submitting ? "正在提交任务" : "开始生成视频"}</button>}
      </section>
      <section className="character-results video-tool-results" aria-label={`${config.title}结果`}>
        <div className="character-section-title"><span>生成结果</span><small>{results.length ? `${results.length} 个本地任务` : "02 / OUTPUT"}</small></div>
        <div className="character-results-body video-tool-results-body">
          <div className="character-preview studio-video-preview">
            {selected?.outputUrl ? <video key={selected.id} src={selected.outputUrl} controls playsInline preload="metadata" /> : <div className="character-empty">{historyLoading ? <><LoaderCircle className="spin" size={26} /><strong>正在读取本地作品</strong></> : <><Film size={31} /><strong>{selected ? "视频正在生成" : "生成结果会显示在这里"}</strong><span>{selected ? `当前进度 ${selected.progress}%` : "上传素材并填写提示词，创建第一段视频"}</span></>}</div>}
            {selected && (selected.status === "queued" || selected.status === "processing") && <div className="character-generating studio-video-generating"><LoaderCircle className="spin" size={28} /><strong>{selected.status === "queued" ? "任务正在排队" : "正在生成视频"}</strong><span>{selected.progress}% · 完成后自动保存到本地</span><div><i style={{ width: `${Math.max(3, selected.progress)}%` }} /></div></div>}
            {selected?.status === "failed" && <div className="studio-video-failed"><X size={24} /><strong>生成未完成</strong><span>{selected.errorMessage || "请调整参数后重新生成"}</span></div>}
            {selected?.outputUrl && <div className="character-preview-actions"><span>{selected.ratio} · {selected.duration}s</span><a className="icon-button" href={selected.outputUrl} download={`${videoType}-${selected.id}.mp4`} aria-label="下载生成视频" title="下载生成视频"><Download size={17} /></a></div>}
          </div>
          <aside className="character-history studio-video-history" aria-label="最近生成"><div><strong>最近生成</strong><span>{results.length ? `${results.length} 个` : "暂无记录"}</span></div>{results.length ? <div className="character-history-strip studio-video-history-strip">{results.map((item, index) => <button type="button" key={item.id} className={`${item.id === selected?.id ? "selected" : ""} ${item.status}`} onClick={() => setSelectedId(item.id)} aria-label={`查看第 ${index + 1} 个视频`}>{item.outputUrl ? <video src={item.outputUrl} muted preload="metadata" /> : <span className="studio-video-history-state">{item.status === "failed" ? <X size={15} /> : <LoaderCircle className="spin" size={15} />}</span>}<b>{item.status === "completed" ? `${item.duration}s` : item.status === "failed" ? "失败" : `${item.progress}%`}</b></button>)}</div> : <div className="character-history-empty"><Film size={18} /><span>生成后显示</span></div>}</aside>
        </div>
      </section>
    </div>
  </main>;
}

type VoiceSample = { file: File; url: string; duration: number };
const voiceWaveform = [28, 45, 34, 68, 52, 81, 39, 61, 88, 57, 73, 43, 91, 64, 36, 76, 48, 84, 55, 70, 42, 87, 60, 32, 72, 49, 79, 38, 66, 90, 53, 74, 41, 82, 58, 69, 35, 77, 50, 63];
const voicePreviewTexts: Record<string, string> = {
  "zh-CN": "你好，很高兴与你见面。愿这个声音为故事带来真实而温暖的表达。",
  "zh-HK": "你好，好高兴同你见面。希望呢把声音可以令故事更加真实自然。",
  "en-US": "A gentle breeze moves across the grass, carrying birdsong through the warm afternoon air.",
  "ja-JP": "こんにちは、お会いできてうれしいです。この声で物語を自然にお届けします。",
};

function VoiceCloneStudio({ onToast }: { onToast: (message: string) => void }) {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("zh-CN");
  const [useCase, setUseCase] = useState("角色对白");
  const [previewText, setPreviewText] = useState(voicePreviewTexts["zh-CN"]);
  const [sampleText, setSampleText] = useState("");
  const [sample, setSample] = useState<VoiceSample | null>(null);
  const [consent, setConsent] = useState(false);
  const [profiles, setProfiles] = useState<VoiceCloneResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [model, setModel] = useState("speech-2.8-hd");
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pageError, setPageError] = useState("");
  const objectUrls = useRef<string[]>([]);

  useEffect(() => () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  useEffect(() => {
    void api.voiceClones().then((result) => {
      setProfiles(result.data);
      setSelectedId(result.data[0]?.id ?? null);
      setConfigured(result.settings.configured);
      setModel(result.settings.model);
    }).catch((caught) => {
      setConfigured(false);
      setPageError(caught instanceof Error ? caught.message : "声音服务读取失败");
    });
  }, []);

  const selected = profiles.find((item) => item.id === selectedId) ?? profiles[0] ?? null;
  const ready = Boolean(name.trim() && sample && previewText.trim() && consent && configured && !creating);
  const changeLanguage = (nextLanguage: string) => {
    setPreviewText((current) => Object.values(voicePreviewTexts).includes(current) ? voicePreviewTexts[nextLanguage] : current);
    setLanguage(nextLanguage);
  };
  const chooseSample = (file: File | undefined) => {
    if (!file) return;
    const extensionOk = /\.(mp3|wav|m4a)$/i.test(file.name);
    const typeOk = ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a"].includes(file.type);
    if (!extensionOk && !typeOk) { setPageError("请选择 MP3、WAV 或 M4A 音频文件"); return; }
    if (file.size > 20 * 1024 * 1024) { setPageError("音频文件不能超过 20MB"); return; }
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      if (!Number.isFinite(audio.duration) || audio.duration < 3) {
        URL.revokeObjectURL(url);
        setPageError("声音样本至少需要 3 秒");
        return;
      }
      objectUrls.current.push(url);
      setSample({ file, url, duration: audio.duration });
      setPageError("");
    };
    audio.onerror = () => { URL.revokeObjectURL(url); setPageError("无法读取该音频，请更换文件后重试"); };
  };
  const createProfile = async () => {
    if (!ready || !sample) return;
    setCreating(true);
    setPageError("");
    try {
      const profile = await api.cloneVoice(sample.file, {
        name: name.trim(), language: language as VoiceCloneResult["language"], useCase, duration: sample.duration,
        previewText: previewText.trim(), sampleText: sampleText.trim() || undefined,
      });
      setProfiles((current) => [profile, ...current.filter((item) => item.id !== profile.id)]);
      setSelectedId(profile.id);
      onToast(`声音“${profile.name}”已创建`);
    } catch (caught) {
      setPageError(caught instanceof Error ? caught.message : "声音克隆失败");
    } finally {
      setCreating(false);
    }
  };
  const removeSample = () => { setSample(null); setConsent(false); setPageError(""); };

  return <main className="character-studio-content voice-clone-content">
    <header className="character-studio-head">
      <div><span className="panel-eyebrow">VOICE CLONE STUDIO</span><h1>声音克隆</h1><p>上传一段清晰的人声样本，创建可用于角色对白和旁白的专属声音。</p></div>
      <span className={`character-config-state ${configured ? "configured" : ""}`}><i />{configured === null ? "正在连接 MiniMax" : configured ? `MiniMax · ${model}` : "MiniMax 未配置"}</span>
    </header>
    <div className="character-studio-layout voice-clone-layout">
      <section className="character-controls voice-clone-controls" aria-label="声音克隆参数">
        <div className="character-section-title"><span>声音设置</span><small>01 / INPUT</small></div>
        <label className="character-field"><span>声音名称</span><input value={name} maxLength={30} onChange={(event) => setName(event.target.value)} placeholder="例如：沉稳男声" /></label>
        <div className="character-field"><span>声音样本</span>
          <label className={`voice-upload ${dragging ? "is-dragging" : ""} ${sample ? "has-file" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); chooseSample(event.dataTransfer.files?.[0]); }}>
            <input type="file" accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4" disabled={creating} onChange={(event) => { chooseSample(event.target.files?.[0]); event.target.value = ""; }} />
            {sample ? <><span className="voice-upload-icon"><FileAudio size={22} /></span><span className="voice-upload-copy"><strong>{sample.file.name}</strong><small>{(sample.file.size / 1024 / 1024).toFixed(1)} MB · {formatDuration(Math.round(sample.duration))}</small></span><button type="button" className="voice-upload-remove" onClick={(event) => { event.preventDefault(); removeSample(); }} aria-label="移除声音样本" title="移除声音样本"><X size={15} /></button></> : <><span className="voice-upload-icon"><Mic2 size={23} /></span><span className="voice-upload-copy"><strong>上传声音样本</strong><small>MP3 / WAV / M4A · 最大 20MB</small></span><span className="voice-upload-action">选择文件</span></>}
          </label>
        </div>
        <div className="voice-parameter-row">
          <div className="character-field"><span>主要语言</span><SmoothSelect value={language} onChange={changeLanguage} ariaLabel="声音主要语言" options={[{ value: "zh-CN", label: "中文（普通话）" }, { value: "zh-HK", label: "中文（粤语）" }, { value: "en-US", label: "英语" }, { value: "ja-JP", label: "日语" }]} /></div>
          <div className="character-field"><span>使用场景</span><SmoothSelect value={useCase} onChange={setUseCase} ariaLabel="声音使用场景" options={["角色对白", "视频旁白", "有声内容", "品牌播报"].map((value) => ({ value, label: value }))} /></div>
        </div>
        <label className="character-field"><span>试听文本</span><textarea value={previewText} maxLength={2000} onChange={(event) => setPreviewText(event.target.value)} placeholder="克隆完成后由新声音朗读的内容" /></label>
        <label className="character-field"><span>样本文本（可选）</span><textarea value={sampleText} maxLength={2000} onChange={(event) => setSampleText(event.target.value)} placeholder="填写音频中逐字说出的内容，可提升克隆准确度" /></label>
        <label className="voice-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span><Check size={12} /></span><p>我已获得声音所有者的明确授权，并同意仅将该声音用于合法内容创作。</p></label>
        {pageError && <div className="character-error" role="alert">{pageError}</div>}
        <button type="button" className="primary-button character-generate" onClick={() => void createProfile()} disabled={!ready}>{creating ? <LoaderCircle className="spin" size={18} /> : <AudioLines size={18} />}{creating ? "正在分析声音" : "开始克隆"}</button>
      </section>
      <section className="character-results voice-clone-results" aria-label="声音克隆结果">
        <div className="character-section-title"><span>声音预览</span><small>{profiles.length ? `${profiles.length} 个声音` : "02 / OUTPUT"}</small></div>
        <div className="voice-results-body">
          <div className="voice-preview">
            {selected ? <div className="voice-profile-preview">
              <div className="voice-profile-mark"><Headphones size={30} /></div>
              <span className="voice-ready-label"><i />VOICE PROFILE READY</span>
              <h2>{selected.name}</h2>
              <p>{selected.useCase} · {selected.language === "zh-CN" ? "中文（普通话）" : selected.language === "zh-HK" ? "中文（粤语）" : selected.language === "en-US" ? "英语" : "日语"}</p>
              <div className="voice-waveform" aria-hidden="true">{voiceWaveform.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
              <audio key={selected.id} src={selected.audioUrl} controls preload="metadata" />
              <small>MiniMax 克隆试听 · {selected.model}</small>
            </div> : <div className="voice-empty"><div className="voice-empty-mark"><AudioLines size={34} /></div><strong>你的专属声音会出现在这里</strong><span>上传干净、无背景音乐的人声样本以获得更稳定的声音特征。</span><div className="voice-waveform idle" aria-hidden="true">{voiceWaveform.map((height, index) => <i key={index} style={{ height: `${Math.max(18, height - 25)}%` }} />)}</div></div>}
            {creating && <div className="character-generating voice-generating"><LoaderCircle className="spin" size={28} /><strong>正在分析声音特征</strong><span>提取音色、节奏与发音特征</span></div>}
          </div>
          <aside className="voice-history" aria-label="最近创建的声音"><div><strong>最近创建</strong><span>{profiles.length ? `${profiles.length} 个` : "暂无记录"}</span></div>{profiles.length ? <div className="voice-history-list">{profiles.map((item) => <button type="button" key={item.id} className={item.id === selected?.id ? "selected" : ""} onClick={() => setSelectedId(item.id)}><span><Headphones size={16} /></span><div><strong>{item.name}</strong><small>{item.useCase} · {formatDuration(Math.round(item.duration))}</small></div><Play size={13} /></button>)}</div> : <div className="character-history-empty"><Mic2 size={18} /><span>创建后显示</span></div>}</aside>
        </div>
      </section>
    </div>
  </main>;
}

const systemSpeechVoices = [
  { value: "female-shaonv", label: "系统 · 清甜女声" },
  { value: "female-yujie", label: "系统 · 成熟女声" },
  { value: "male-qn-qingse", label: "系统 · 青年男声" },
  { value: "male-qn-jingying", label: "系统 · 精英男声" },
  { value: "presenter_female", label: "系统 · 女主持" },
  { value: "presenter_male", label: "系统 · 男主持" },
];
const speechEmotionLabels: Record<SpeechEmotion, string> = { neutral: "自然", happy: "高兴", sad: "悲伤", angry: "愤怒", fearful: "害怕", surprised: "惊讶" };
const speechLanguageOptions: Array<{ value: SpeechLanguageBoost; label: string }> = [
  { value: "Chinese", label: "中文（普通话）" }, { value: "Chinese,Yue", label: "中文（粤语）" },
  { value: "English", label: "英语" }, { value: "Japanese", label: "日语" },
];

function TextToSpeechStudio({ onToast }: { onToast: (message: string) => void }) {
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [pitch, setPitch] = useState(0);
  const [emotion, setEmotion] = useState<SpeechEmotion>("neutral");
  const [languageBoost, setLanguageBoost] = useState<SpeechLanguageBoost>("Chinese");
  const [format, setFormat] = useState<"mp3" | "flac">("mp3");
  const [sampleRate, setSampleRate] = useState<32000 | 44100>(32000);
  const [clonedVoices, setClonedVoices] = useState<VoiceCloneResult[]>([]);
  const [generations, setGenerations] = useState<TextToSpeechResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [model, setModel] = useState("speech-2.8-hd");
  const [generating, setGenerating] = useState(false);
  const [pageError, setPageError] = useState("");

  const voiceOptions = useMemo(() => [
    ...clonedVoices.map((voice) => ({ value: voice.voiceId, label: `克隆 · ${voice.name}` })),
    ...systemSpeechVoices,
  ], [clonedVoices]);
  const selectedVoiceName = voiceOptions.find((voice) => voice.value === voiceId)?.label.replace(/^(克隆|系统) · /, "") ?? voiceId;
  const selected = generations.find((item) => item.id === selectedId) ?? generations[0] ?? null;
  const ready = Boolean(configured && text.trim() && voiceId && !generating);

  useEffect(() => {
    void Promise.all([api.voiceClones(), api.speechGenerations()]).then(([voices, speech]) => {
      setClonedVoices(voices.data);
      setGenerations(speech.data);
      setSelectedId(speech.data[0]?.id ?? null);
      setConfigured(speech.settings.configured);
      setModel(speech.settings.model);
      setVoiceId(voices.data[0]?.voiceId ?? systemSpeechVoices[0].value);
    }).catch((caught) => {
      setConfigured(false);
      setPageError(caught instanceof Error ? caught.message : "语音服务读取失败");
    });
  }, []);

  const generateSpeech = async () => {
    if (!ready) return;
    setGenerating(true);
    setPageError("");
    try {
      const result = await api.generateSpeech({ text: text.trim(), voiceId, voiceName: selectedVoiceName, speed, volume, pitch, emotion, languageBoost, format, sampleRate });
      setGenerations((current) => [result, ...current.filter((item) => item.id !== result.id)]);
      setSelectedId(result.id);
      onToast("语音已生成并保存");
    } catch (caught) {
      setPageError(caught instanceof Error ? caught.message : "语音生成失败");
    } finally {
      setGenerating(false);
    }
  };

  return <main className="character-studio-content text-to-speech-content">
    <header className="character-studio-head">
      <div><span className="panel-eyebrow">TEXT TO SPEECH STUDIO</span><h1>文转语音</h1><p>选择声音并调整表达参数，将对白、旁白或播报文本生成可下载音频。</p></div>
      <span className={`character-config-state ${configured ? "configured" : ""}`}><i />{configured === null ? "正在连接 MiniMax" : configured ? `MiniMax · ${model}` : "MiniMax 未配置"}</span>
    </header>
    <div className="character-studio-layout voice-clone-layout text-to-speech-layout">
      <section className="character-controls voice-clone-controls text-to-speech-controls" aria-label="文转语音参数">
        <div className="character-section-title"><span>合成设置</span><small>01 / INPUT</small></div>
        <label className="character-field tts-text-field"><span>朗读文本 <small>{text.length} / 10000</small></span><textarea value={text} maxLength={10000} onChange={(event) => setText(event.target.value)} placeholder="输入需要转换成语音的对白或旁白……" /></label>
        <div className="character-field"><span>声音</span><SmoothSelect value={voiceId} onChange={setVoiceId} ariaLabel="选择朗读声音" options={voiceOptions} /></div>
        <div className="tts-select-grid">
          <div className="character-field"><span>语言</span><SmoothSelect value={languageBoost} onChange={(value) => setLanguageBoost(value as SpeechLanguageBoost)} ariaLabel="文本语言" options={speechLanguageOptions} /></div>
          <div className="character-field"><span>情绪</span><SmoothSelect value={emotion} onChange={(value) => setEmotion(value as SpeechEmotion)} ariaLabel="朗读情绪" options={(Object.keys(speechEmotionLabels) as SpeechEmotion[]).map((value) => ({ value, label: speechEmotionLabels[value] }))} /></div>
          <div className="character-field"><span>格式</span><SmoothSelect value={format} onChange={(value) => setFormat(value as "mp3" | "flac")} ariaLabel="音频格式" options={[{ value: "mp3", label: "MP3" }, { value: "flac", label: "FLAC" }]} /></div>
          <div className="character-field"><span>采样率</span><SmoothSelect value={String(sampleRate)} onChange={(value) => setSampleRate(Number(value) as 32000 | 44100)} ariaLabel="音频采样率" options={[{ value: "32000", label: "32 kHz" }, { value: "44100", label: "44.1 kHz" }]} /></div>
        </div>
        <div className="tts-slider-grid">
          <label className="tts-slider"><span>语速 <output>{speed.toFixed(1)}x</output></span><input type="range" min="0.5" max="2" step="0.1" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></label>
          <label className="tts-slider"><span>音量 <output>{volume.toFixed(1)}</output></span><input type="range" min="0.1" max="10" step="0.1" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label>
          <label className="tts-slider"><span>音高 <output>{pitch > 0 ? `+${pitch}` : pitch}</output></span><input type="range" min="-12" max="12" step="1" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} /></label>
        </div>
        {pageError && <div className="character-error" role="alert">{pageError}</div>}
        <button type="button" className="primary-button character-generate" onClick={() => void generateSpeech()} disabled={!ready}>{generating ? <LoaderCircle className="spin" size={18} /> : <AudioLines size={18} />}{generating ? "正在生成语音" : "生成语音"}</button>
      </section>
      <section className="character-results voice-clone-results text-to-speech-results" aria-label="文转语音结果">
        <div className="character-section-title"><span>音频预览</span><small>{generations.length ? `${generations.length} 条记录` : "02 / OUTPUT"}</small></div>
        <div className="voice-results-body">
          <div className="voice-preview tts-preview">
            {selected ? <div className="voice-profile-preview tts-profile-preview">
              <div className="voice-profile-mark"><Headphones size={30} /></div>
              <span className="voice-ready-label"><i />AUDIO READY</span>
              <h2>{selected.voiceName}</h2>
              <p>{speechEmotionLabels[selected.emotion]} · {selected.speed.toFixed(1)}x · {selected.format.toUpperCase()} · {(selected.sampleRate / 1000).toFixed(selected.sampleRate === 44100 ? 1 : 0)} kHz</p>
              <div className="voice-waveform" aria-hidden="true">{voiceWaveform.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
              <audio key={selected.id} src={selected.audioUrl} controls preload="metadata" />
              <p className="tts-result-text">{selected.text}</p>
              <a className="secondary-button tts-download" href={selected.audioUrl} download={`${selected.voiceName}.${selected.format}`}><Download size={15} />下载音频</a>
            </div> : <div className="voice-empty"><div className="voice-empty-mark"><AudioLines size={34} /></div><strong>生成的音频会出现在这里</strong><span>选择一个声音并输入文本，即可生成适用于对白、旁白和播报的语音。</span><div className="voice-waveform idle" aria-hidden="true">{voiceWaveform.map((height, index) => <i key={index} style={{ height: `${Math.max(18, height - 25)}%` }} />)}</div></div>}
            {generating && <div className="character-generating voice-generating"><LoaderCircle className="spin" size={28} /><strong>正在合成语音</strong><span>处理文本韵律、情绪与声音特征</span></div>}
          </div>
          <aside className="voice-history" aria-label="最近生成的语音"><div><strong>最近生成</strong><span>{generations.length ? `${generations.length} 条` : "暂无记录"}</span></div>{generations.length ? <div className="voice-history-list">{generations.map((item) => <button type="button" key={item.id} className={item.id === selected?.id ? "selected" : ""} onClick={() => setSelectedId(item.id)}><span><Headphones size={16} /></span><div><strong>{item.voiceName}</strong><small>{item.text}</small></div><Play size={13} /></button>)}</div> : <div className="character-history-empty"><AudioLines size={18} /><span>生成后显示</span></div>}</aside>
        </div>
      </section>
    </div>
  </main>;
}

function HomeStage({ projects, stats, onNew, onManage, onOpen, onDelete }: { projects: Project[]; stats?: DashboardData["stats"]; onNew: () => void; onManage: () => void; onOpen: (project: Project, stage?: Stage) => void; onDelete: (project: Project) => void }) {
  const projectsWithCovers = projects.filter((item) => item.coverUrl);
  const slides = (projectsWithCovers.length ? projectsWithCovers : projects).slice(0, 5);
  const [slideIndex, setSlideIndex] = useState(0);
  const [carouselPaused, setCarouselPaused] = useState(false);
  const featured = slides[slideIndex];

  useEffect(() => {
    setSlideIndex((current) => slides.length ? current % slides.length : 0);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1 || carouselPaused) return;
    const timer = window.setInterval(() => setSlideIndex((current) => (current + 1) % slides.length), 5200);
    return () => window.clearInterval(timer);
  }, [carouselPaused, slides.length]);

  return <main id="home" className="home-content">
    <section className="home-hero">
      <div className="hero-copy"><span className="panel-eyebrow"></span><h1>把剧本，变成<br /><em>可见的故事。</em></h1><p>从项目设定开始，经过剧本格式化、分集解析、主体生成和故事板，一条流水线完成视频创作准备。</p><div className="hero-actions"><button className="primary-button" onClick={onNew}>开始创作</button></div></div>
      <div className="hero-showcase" aria-roledescription="轮播图" aria-label="最近项目" onMouseEnter={() => setCarouselPaused(true)} onMouseLeave={() => setCarouselPaused(false)}>
        <div className="showcase-media" key={featured?.id ?? "empty"}>{featured?.coverUrl ? <img src={featured.coverUrl} alt="" /> : <div className="showcase-placeholder"><Film size={42} /><span>YOUR NEXT FILM</span></div>}</div>
        <div className="showcase-shade" />
        <div className="showcase-copy" aria-live="polite"><strong>{featured?.title ?? "YOUR NEXT FILM"}</strong><small>{featured?.logline || featured?.style || "从一份剧本开始"}</small></div>
      </div>
    </section>
    <section className="home-section">
      <div className="home-section-head">
        <div><span className="panel-eyebrow">YOUR PROJECTS</span><h2>项目展示</h2></div>
        <div className="home-section-tools">
          <span className="project-count">{stats?.projectCount ?? 0} 个项目</span>
          <div className="home-section-actions">
            <button className="text-button" onClick={onManage}><FolderOpen size={14} />进入创作台</button>
            {(stats?.projectCount ?? 0) > 6 && <button className="text-button home-more-button" onClick={onManage}>查看更多...</button>}
          </div>
        </div>
      </div>
      {projects.length ? <div className="home-project-grid">{projects.slice(0, 6).map((item) => <ProjectCard key={item.id} project={item} onOpen={onOpen} onDelete={onDelete} />)}</div> : <div className="home-empty"><Film size={26} /><p>还没有项目，从一份剧本开始。</p><button className="secondary-button" onClick={onNew}><Plus size={16} /> 新建第一个项目</button></div>}
    </section>
    <section id="pipeline" className="home-pipeline"><div><span className="panel-eyebrow">PIPELINE</span><h2>一条清晰的创作路径</h2></div><div className="pipeline-cards">{stages.map((item, index) => { const Icon = item.icon; return <div className="pipeline-card" key={item.id}><span>0{index + 1}</span><Icon size={19} /><strong>{item.label}</strong><small>{item.description}</small></div>; })}</div></section>
    <footer className="home-footer">
      <div className="home-footer-brand"><strong>拥抱世界 AI</strong><small>Copyright © 2026 拥抱世界</small></div>
      <div className="home-footer-info"><span>本地创作工作区</span><i /><span>项目数据保存在当前设备</span><i /><span>剧本到视频一体化创作</span></div>
    </footer>
  </main>;
}

function ProjectCard({ project, onOpen, onDelete }: { project: Project; onOpen: (project: Project, stage?: Stage) => void; onDelete: (project: Project) => void }) {
  const truncateLogline = (text: string) => text.length > 72 ? `${text.slice(0, 72)}...` : text;
  return <article className="home-project-card">
    <button type="button" className="project-card-open" aria-label={`进入项目 ${project.title}`} onClick={() => onOpen(project)} />
    <div className="home-project-cover">{project.coverUrl ? <img src={project.coverUrl} alt="" /> : <Film size={28} />}<span>{project.status === "completed" ? "已完成" : `${project.progress}% 进行中`}</span></div>
    <div className="home-project-body">
      <div className="home-project-heading"><div><span className="project-genre">{project.genre}</span><strong>{project.title}</strong></div><button className="icon-button small-icon delete-project-button" aria-label={`删除项目 ${project.title}`} title="删除项目" onClick={() => onDelete(project)}><Trash2 size={15} /></button></div>
      <p>{truncateLogline(project.logline || "尚未填写项目简介")}</p>
      <div className="home-project-meta"><span>{project.style}</span><span>{project.aspectRatio}</span><span>{project.durationSeconds}s / 集</span></div>
    </div>
  </article>;
}

const assetKindLabels: Record<AssetLibraryKind, string> = { character: "角色", scene: "场景", prop: "道具", audio: "音频", video: "视频" };
const assetFilters: Array<{ id: "all" | AssetLibraryKind; label: string; icon: typeof FileText }> = [
  { id: "all", label: "全部", icon: Sparkles },
  { id: "character", label: "角色", icon: UsersRound },
  { id: "scene", label: "场景", icon: Layers3 },
  { id: "prop", label: "道具", icon: ImagePlus },
  { id: "audio", label: "音频", icon: AudioLines },
  { id: "video", label: "视频", icon: Film },
];
function AssetLibraryStage({ data, loading, onCreate }: { data: AssetLibraryData | null; loading: boolean; onCreate: (toolType: HomeToolType) => void }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | AssetLibraryKind>("all");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const items = data?.items ?? [];
  const filtered = items.filter((item) => {
    if (kind !== "all" && item.kind !== kind) return false;
    if (!normalizedQuery) return true;
    return [item.title, item.description, item.projectTitle ?? "", item.detail, assetKindLabels[item.kind]].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  });
  const counts = data?.counts ?? { character: 0, scene: 0, prop: 0, audio: 0, video: 0 };
  const imageCount = counts.character + counts.scene + counts.prop;
  const createType: HomeToolType = kind === "scene" ? "scene" : kind === "prop" ? "prop" : kind === "audio" ? "text-to-speech" : kind === "video" ? "reference-video" : "character";

  return <main className="asset-library-content">
    <header className="asset-library-head">
      <div><span className="panel-eyebrow">ASSET LIBRARY</span><h1>资产库</h1><p>集中管理流水线和独立工具已经生成的角色、场景、道具、音频与视频。</p></div>
      <button type="button" className="primary-button" onClick={() => onCreate(createType)}><Sparkles size={16} />生成新资产</button>
    </header>
    <section className="asset-summary" aria-label="资产统计">
      <div><span>全部资产</span><strong>{items.length}</strong></div>
      <div><span>图片</span><strong>{imageCount}</strong></div>
      <div><span>音频</span><strong>{counts.audio}</strong></div>
      <div><span>视频</span><strong>{counts.video}</strong></div>
    </section>
    <div className="asset-toolbar">
      <label className="manager-search asset-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、描述或所属项目" aria-label="搜索资产" />{query && <button type="button" className="icon-button small-icon" onClick={() => setQuery("")} aria-label="清空资产搜索" title="清空搜索"><X size={15} /></button>}</label>
      <div className="asset-filter-tabs" role="group" aria-label="资产类型">{assetFilters.map((filter) => { const Icon = filter.icon; const count = filter.id === "all" ? items.length : counts[filter.id]; return <button type="button" key={filter.id} className={kind === filter.id ? "selected" : ""} onClick={() => setKind(filter.id)}><Icon size={14} />{filter.label}<span>{count}</span></button>; })}</div>
    </div>
    <div className="asset-result-bar"><span>{loading ? "正在读取资产" : `${filtered.length} 项结果`}</span><small>按最近生成时间排序</small></div>
    {loading ? <div className="asset-library-empty"><LoaderCircle className="spin" size={23} /><strong>正在整理资产</strong><span>正在汇总项目和更多工具中的生成结果</span></div> : filtered.length ? <div className="asset-library-grid">{filtered.map((item) => <AssetLibraryCard key={item.id} item={item} />)}</div> : <div className="asset-library-empty"><FolderOpen size={25} /><strong>{query ? "没有找到匹配的资产" : kind === "all" ? "还没有生成资产" : `还没有${assetKindLabels[kind]}资产`}</strong><span>{query ? "尝试更换关键词或资产类型" : "生成完成的内容会自动归档到这里"}</span><button type="button" className="secondary-button" onClick={() => onCreate(createType)}><Sparkles size={15} />开始生成</button></div>}
  </main>;
}

function AssetLibraryCard({ item }: { item: AssetLibraryItem }) {
  const isVideo = item.mediaType === "video";
  const [videoControlsVisible, setVideoControlsVisible] = useState(false);
  return <article
    className={`asset-library-card ${item.mediaType}`}
    onPointerEnter={(event) => { if (isVideo && event.pointerType === "mouse") setVideoControlsVisible(true); }}
    onPointerLeave={(event) => { if (isVideo && event.pointerType === "mouse") setVideoControlsVisible(false); }}
    onPointerDown={(event) => { if (isVideo && event.pointerType !== "mouse") setVideoControlsVisible(true); }}
    onFocusCapture={() => { if (isVideo) setVideoControlsVisible(true); }}
    onBlurCapture={(event) => { if (isVideo && !event.currentTarget.contains(event.relatedTarget)) setVideoControlsVisible(false); }}
  >
    <div className="asset-card-media">
      {item.mediaType === "image" ? <a className="asset-card-preview" href={item.mediaUrl} target="_blank" rel="noreferrer" aria-label={`查看${item.title}`}><img src={item.mediaUrl} alt={item.title} loading="lazy" /><span><Eye size={20} /></span></a> : isVideo ? <video src={item.mediaUrl} poster={item.thumbnailUrl ?? undefined} controls={videoControlsVisible} preload="metadata" aria-label={item.title} /> : <div className="asset-audio-preview"><span><AudioLines size={27} /></span><audio src={item.mediaUrl} controls preload="metadata" /></div>}
      <a className="asset-card-download" href={item.mediaUrl} download aria-label={`下载${item.title}`} title="下载资产"><Download size={16} /></a>
    </div>
    <div className="asset-card-body asset-card-description"><p title={item.description}>{item.description || (isVideo ? "暂无提示词" : "暂无描述")}</p></div>
  </article>;
}

function ProjectManagerStage({ projects, loading, onOpen, onDelete, onNew }: { projects: Project[]; loading: boolean; onOpen: (project: Project, stage?: Stage) => void; onDelete: (project: Project) => void; onNew: () => void }) {
  const [query, setQuery] = useState("");
  const [matchMode, setMatchMode] = useState<"fuzzy" | "exact">("fuzzy");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = projects.filter((project) => {
    if (!normalizedQuery) return true;
    const fields = [project.title, project.logline, project.genre, project.style, project.status];
    return matchMode === "exact" ? fields.some((field) => field.toLocaleLowerCase() === normalizedQuery) : fields.some((field) => field.toLocaleLowerCase().includes(normalizedQuery));
  });
  return <main className="manager-content"><div className="manager-head"><div><span className="panel-eyebrow">CREATION WORKSPACE</span><h1>创作台</h1><p>集中管理剧本项目，查看创作进度并继续未完成的制作流程。</p></div><div className="manager-head-actions"><button className="primary-button" onClick={onNew}>开始创作</button></div></div><div className="manager-toolbar"><label className="manager-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目名称、简介、类型或风格" aria-label="搜索项目" /><button className="icon-button small-icon" onClick={() => setQuery("")} disabled={!query} aria-label="清空搜索"><X size={15} /></button></label><div className="manager-filters"><span className="manager-result-count">{loading ? "正在读取" : `找到 ${filtered.length} 个项目`}</span><div className="match-toggle" role="group" aria-label="匹配方式"><button className={matchMode === "fuzzy" ? "selected" : ""} onClick={() => setMatchMode("fuzzy")}><ListFilter size={14} />模糊匹配</button><button className={matchMode === "exact" ? "selected" : ""} onClick={() => setMatchMode("exact")}><Search size={14} />精确匹配</button></div></div></div>{loading ? <div className="manager-empty"><LoaderCircle className="spin" size={22} /><p>正在载入创作项目</p></div> : filtered.length ? <div className="manager-grid">{filtered.map((item) => <ProjectCard key={item.id} project={item} onOpen={onOpen} onDelete={onDelete} />)}</div> : <div className="manager-empty"><Search size={24} /><p>{query ? "没有找到匹配的项目" : "还没有项目"}</p><small>{query ? "换一个关键词或切换匹配方式试试" : "从开始创作建立第一个项目"}</small></div>}</main>;
}

function NewProjectDialog({ onHasScript, onNoScript, onClose }: { onHasScript: () => void; onNoScript: () => void; onClose: () => void }) {
  return <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="new-project-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title"><div className="settings-dialog-head"><div><span className="panel-eyebrow">NEW PROJECT</span><h2 id="new-project-title">先选择你的创作起点</h2><p>已有剧本先设定生成参数，再进入格式化；没有剧本则先设定项目并生成剧本。</p></div><button className="icon-button" onClick={onClose} aria-label="关闭开始创作"><X size={18} /></button></div><div className="new-project-options"><button className="new-project-option" onClick={onHasScript}><span className="new-project-option-icon"><FileText size={19} /></span><span><strong>已有剧本</strong><small>先选择内容类型、风格和时长，再粘贴或导入剧本</small></span><ArrowRight size={17} /></button><button className="new-project-option" onClick={onNoScript}><span className="new-project-option-icon accent"><WandSparkles size={19} /></span><span><strong>没有剧本</strong><small>填写项目设定，由模型生成剧本草案</small></span><ArrowRight size={17} /></button></div></section></div>;
}

function ExistingScriptSetupDialog({ draft, setDraft, busy, onConfirm, onClose }: { draft: ProjectDraft; setDraft: React.Dispatch<React.SetStateAction<ProjectDraft>>; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const change = (key: keyof ProjectDraft, value: string | number) => setDraft((current) => ({ ...current, [key]: value }));
  const loglineLength = draft.logline.trim().length;
  return <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="settings-dialog existing-script-dialog" role="dialog" aria-modal="true" aria-labelledby="existing-script-title"><div className="settings-dialog-head"><div><span className="panel-eyebrow">EXISTING SCRIPT</span><h2 id="existing-script-title">先设定项目参数</h2><p>这些参数会带入后续主体生图、分镜和视频生成。</p></div><button className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭项目参数"><X size={18} /></button></div><div className="existing-script-form"><label className="setup-field existing-script-title"><span>剧本名称</span><input value={draft.title} onChange={(event) => change("title", event.target.value)} placeholder="例如：午夜车站" /></label><label className="setup-field existing-script-logline"><span>一句话简介</span><div className="setup-logline-editor"><textarea value={draft.logline} maxLength={5000} onChange={(event) => change("logline", event.target.value)} placeholder="至少输入 50 个字，概括故事的核心冲突或人物目标" /><small className={`field-counter ${loglineLength >= MIN_LOGLINE_LENGTH ? "ready" : ""}`}>{loglineLength} / 5000（至少 50 字）</small></div></label><div className="setup-field"><span>内容类型</span><SmoothSelect value={draft.genre} onChange={(value) => change("genre", value)} ariaLabel="内容类型" options={["悬疑", "剧情", "科幻", "都市情感", "奇幻", "短片"].map((value) => ({ value, label: value }))} /></div><div className="setup-field"><span>视觉风格</span><SmoothSelect value={draft.style} onChange={(value) => change("style", value)} ariaLabel="视觉风格" options={["电影写实", "赛博电影", "胶片写实", "日系动画", "国风水墨", "3D 渲染"].map((value) => ({ value, label: value }))} /></div><div className="setup-field"><span>画面比例</span><SmoothSelect value={draft.aspectRatio} onChange={(value) => change("aspectRatio", value)} ariaLabel="画面比例" options={[{ value: "16:9", label: "16:9 · 横屏" }, { value: "9:16", label: "9:16 · 竖屏" }, { value: "1:1", label: "1:1 · 方形" }]} /></div><div className="setup-field"><span>每集目标时长</span><SmoothSelect value={String(draft.durationSeconds)} onChange={(value) => change("durationSeconds", Number(value))} ariaLabel="每集目标时长" options={targetDurationOptions.map((value) => ({ value: String(value), label: `${value} 秒` }))} /></div></div><div className="settings-actions existing-script-actions"><button className="secondary-button" onClick={onClose} disabled={busy}>取消</button><button className="primary-button" onClick={onConfirm} disabled={busy || !draft.title.trim() || loglineLength < MIN_LOGLINE_LENGTH}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}确定，进入剧本格式化</button></div></section></div>;
}

function DeleteSubjectDialog({ subject, busy, onConfirm, onClose }: { subject: Subject; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  return <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="settings-dialog delete-project-dialog delete-subject-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-subject-title"><div className="settings-dialog-head"><div><span className="panel-eyebrow">DELETE SUBJECT</span><h2 id="delete-subject-title">删除这个主体吗？</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭删除确认" disabled={busy}><X size={18} /></button></div><div className="delete-project-warning"><Trash2 size={18} /><p>主体“<strong>{subject.name}</strong>”将从当前项目中移除，已生成的分镜内容不会自动修改。</p></div><div className="settings-actions"><button className="secondary-button" onClick={onClose} disabled={busy}>取消</button><button className="danger-button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}确认删除</button></div></section></div>;
}

function DeleteProjectDialog({ project, busy, onConfirm, onClose }: { project: Project; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  return <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="settings-dialog delete-project-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-project-title"><div className="settings-dialog-head"><div><span className="panel-eyebrow">DELETE PROJECT</span><h2 id="delete-project-title">确定删除这个项目吗？</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭删除确认" disabled={busy}><X size={18} /></button></div><div className="delete-project-warning"><Trash2 size={18} /><p>项目“<strong>{project.title}</strong>”及其剧本、分集、主体和分镜数据将一并删除，且无法恢复。</p></div><div className="settings-actions"><button className="secondary-button" onClick={onClose} disabled={busy}>取消</button><button className="danger-button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}确认删除</button></div></section></div>;
}

function SmoothSelect({ value, options, onChange, ariaLabel, disabled = false }: { value: string; options: SelectOption[]; onChange: (value: string) => void; ariaLabel: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const close = (event: MouseEvent) => { if (container.current && !container.current.contains(event.target as Node)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const selected = options.find((option) => option.value === value) ?? options[0];
  return <div className={`smooth-select ${open ? "is-open" : ""} ${disabled ? "is-disabled" : ""}`} ref={container}><button type="button" className="smooth-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}><span>{selected?.label ?? value}</span><ChevronDown size={16} /></button>{open && <div className="smooth-select-menu" role="listbox" aria-label={ariaLabel}>{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={option.value === value ? "selected" : ""} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}{option.value === value && <Check size={14} />}</button>)}</div>}</div>;
}

function SetupStage({ draft, setDraft, onNext, working, generate }: { draft: ProjectDraft; setDraft: React.Dispatch<React.SetStateAction<ProjectDraft>>; onNext: () => void; working: boolean; generate: boolean }) {
  const change = (key: keyof ProjectDraft, value: string | number) => setDraft((current) => ({ ...current, [key]: value }));
  const loglineLength = draft.logline.trim().length;
  return <div className="stage-view setup-view"><StepHeader eyebrow="01 / PROJECT SETUP" title="先定义这个故事的边界" description="设定画面比例、类型和整体风格，后续格式化、主体生成与故事板都会以此为统一基准。" /><div className="setup-form"><label className="setup-title"><span>项目名称</span><input value={draft.title} onChange={(event) => change("title", event.target.value)} placeholder="例如：午夜车站" /></label><label className="setup-wide"><span>一句话简介</span><div className="setup-logline-editor"><textarea value={draft.logline} maxLength={5000} onChange={(event) => change("logline", event.target.value)} placeholder="至少输入 50 个字，描述故事的核心冲突、人物目标和故事走向" /><small className={`field-counter ${loglineLength >= MIN_LOGLINE_LENGTH ? "ready" : ""}`}>{loglineLength} / 5000（至少 50 字）</small></div></label><div className="setup-field setup-genre"><span>内容类型</span><SmoothSelect value={draft.genre} onChange={(value) => change("genre", value)} ariaLabel="内容类型" options={["悬疑", "剧情", "科幻", "都市情感", "奇幻", "短片"].map((value) => ({ value, label: value }))} /></div><div className="setup-field"><span>视觉风格</span><SmoothSelect value={draft.style} onChange={(value) => change("style", value)} ariaLabel="视觉风格" options={["电影写实", "赛博电影", "胶片写实", "日系动画", "国风水墨", "3D 渲染"].map((value) => ({ value, label: value }))} /></div><div className="setup-field"><span>画面比例</span><SmoothSelect value={draft.aspectRatio} onChange={(value) => change("aspectRatio", value)} ariaLabel="画面比例" options={[{ value: "16:9", label: "16:9 · 横屏" }, { value: "9:16", label: "9:16 · 竖屏" }, { value: "1:1", label: "1:1 · 方形" }]} /></div><div className="setup-field"><span>每集目标时长（秒）</span><SmoothSelect value={String(draft.durationSeconds)} onChange={(value) => change("durationSeconds", Number(value))} ariaLabel="每集目标时长" options={targetDurationOptions.map((value) => ({ value: String(value), label: `${value} 秒` }))} /></div><label className="setup-episode-count"><span>目标集数</span><input type="number" min="1" max="100" value={draft.targetEpisodeCount} onChange={(event) => change("targetEpisodeCount", Math.min(100, Math.max(1, Number(event.target.value) || 3)))} /></label></div><div className="setup-spacer" /><div className="action-row setup-actions"><span className="action-hint"><Settings2 size={15} /> {loglineLength < MIN_LOGLINE_LENGTH ? `一句话简介还需 ${MIN_LOGLINE_LENGTH - loglineLength} 个字` : generate ? "项目设定将传给模型，生成一份可继续格式化的剧本" : "项目设定完成后进入剧本格式化"}</span><button className="primary-button" onClick={onNext} disabled={working || !draft.title.trim() || loglineLength < MIN_LOGLINE_LENGTH}>{working ? <LoaderCircle className="spin" size={17} /> : generate ? <WandSparkles size={17} /> : <Check size={17} />}{generate ? "开始生成剧本" : "保存设定，下一步"}{!generate && <ArrowRight size={16} />}</button></div></div>;
}

function StepHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) { return <div className="step-header"><div><span className="panel-eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>{action}</div>; }
function ImportStage({ text, setText, onFile, onNext, working, fileInput, onFileChange }: { text: string; setText: (value: string) => void; onFile: () => void; onNext: () => void; working: boolean; fileInput: React.RefObject<HTMLInputElement | null>; onFileChange: (event: ChangeEvent<HTMLInputElement>) => void }) { return <div className="stage-view import-view"><StepHeader eyebrow="01 / SOURCE SCRIPT" title="把剧本放进来" description="支持纯文本、Markdown 或直接粘贴。先保留原始内容，后续步骤会生成可回溯的结构化版本。" action={<button className="secondary-button" onClick={() => setText(sampleScript)}><Sparkles size={15} /> 使用示例</button>} /><div className="editor-shell"><div className="editor-toolbar"><span className="file-label"><FileText size={15} /> {text ? `${text.split("\n")[0].slice(0, 22)}.txt` : "未命名剧本.txt"}</span><span className="toolbar-muted">UTF-8 · {text.length} / 200000 字</span><button className="toolbar-upload" onClick={onFile}><Upload size={14} /> 导入文件</button><input ref={fileInput} type="file" accept=".txt,.md,.markdown" hidden onChange={onFileChange} /></div><textarea className="script-editor" value={text} maxLength={MAX_SCRIPT_LENGTH} onChange={(event) => setText(event.target.value)} placeholder="在这里粘贴剧本……\n\n建议包含：场次、时间地点、人物、动作和对白。" spellCheck={false} /><div className="editor-foot"><span><i className={text.length >= 30 ? "ready" : ""} />{text.length >= 30 ? "内容已就绪，可以开始格式化" : "至少输入 30 个字符"}</span><span>{text.length} / 200000 字 · {text.split(/\s+/).filter(Boolean).length} tokens</span></div></div><div className="action-row"><span className="action-hint"><WandSparkles size={15} /> 下一步会识别场次、人物和对白结构</span><button className="primary-button" onClick={onNext} disabled={working || text.trim().length < 30}>{working ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />}格式化剧本</button></div></div>; }
function FormatStage({ document, onNext, working }: { document: PipelineData["document"]; onNext: () => void; working: boolean }) { return <div className="stage-view"><StepHeader eyebrow="02 / FORMAT" title="标准化剧本格式" description="统一场次、人物、动作和对白标记，后续提取会以这份结构化文本为准。" action={<span className="ready-badge"><Check size={14} /> 原文保真</span>} /><div className="compare-grid"><div className="text-pane"><div className="pane-head"><span>原始文本</span><small>READ ONLY</small></div><pre>{document?.originalText}</pre></div><div className="text-pane formatted"><div className="pane-head"><span>标准格式</span><small>READ ONLY</small></div><pre>{document?.formattedText}</pre></div></div><div className="action-row"><span className="action-hint"><Check size={15} /> 原文已单独归档，可进入分集</span><button className="primary-button" onClick={onNext} disabled={working}>{working ? <LoaderCircle className="spin" size={17} /> : <Layers3 size={17} />}提取分集</button></div></div>; }
function EpisodesStage({ episodes, onNext, working }: { episodes: Episode[]; onNext: () => void; working: boolean }) { return <div className="stage-view"><StepHeader eyebrow="03 / EPISODES" title="分集结构" description="将长篇故事拆成可独立生产的集数。每集都可以单独提取主体和分镜。" action={<button className="secondary-button"><Plus size={15} /> 添加一集</button>} /><div className="episode-list">{episodes.map((episode) => <EpisodeCard key={episode.id} episode={episode} />)}</div><div className="action-row"><span className="action-hint"><Layers3 size={15} /> {episodes.length} 集 · 结构已建立</span><button className="primary-button" onClick={onNext} disabled={working || !episodes.length}>{working ? <LoaderCircle className="spin" size={17} /> : <UsersRound size={17} />}提取主体</button></div></div>; }

function DetailField({ label, value }: { label: string; value: string }) { return <div className="detail-field"><span>{label}</span><p>{value || "未设定"}</p></div>; }

function EpisodeCard({ episode }: { episode: Episode }) {
  const [open, setOpen] = useState(false);
  const plotNodes = episode.plotNodes ?? [];
  const characters = episode.characters ?? [];
  return <article className={`episode-card ${open ? "is-open" : ""}`}>
    <span className="episode-index">E{String(episode.episodeNumber).padStart(2, "0")}</span>
    <div className="episode-main">
      <div className="edit-line"><input defaultValue={episode.title} aria-label={`第${episode.episodeNumber}集标题`} /><span className="status-chip"><Check size={12} /> AI STRUCTURED</span></div>
      <p className="episode-summary">{episode.summary}</p>
      <div className="episode-meta"><span><Film size={13} /> {episode.sceneCount || "—"} 场</span><span><Clapperboard size={13} /> 可提取分镜</span><span>{characters.length} 位人物</span></div>
      <button className="episode-view-button" onClick={() => setOpen((current) => !current)} aria-expanded={open}><FileText size={15} /> {open ? "收起本集内容" : "查看本集完整内容"}<ChevronDown size={15} className={open ? "rotate" : ""} /></button>
      {open && <div className="episode-detail">
        <div className="episode-detail-grid">
          <section className="episode-detail-section hook-section"><div className="detail-section-title"><Sparkles size={15} /><h3>本集钩子</h3></div><p>{episode.hook || "未明确设定"}</p></section>
          <section className="episode-detail-section"><div className="detail-section-title"><Layers3 size={15} /><h3>情节节点</h3></div>{plotNodes.length ? <ol className="plot-node-list">{plotNodes.map((node, index) => <li key={`${episode.id}-plot-${index}`}><b>{String(index + 1).padStart(2, "0")}</b><span>{node}</span></li>)}</ol> : <p className="empty-detail">未返回情节节点</p>}</section>
        </div>
        <section className="episode-detail-section original-section"><div className="detail-section-title"><FileText size={15} /><h3>本集格式化内容</h3><span>来自标准格式</span></div><pre>{episode.originalText || "未返回本集格式化内容"}</pre></section>
        <section className="episode-detail-section characters-section"><div className="detail-section-title"><UsersRound size={15} /><h3>参与人物</h3><span>{characters.length} 人</span></div>{characters.length ? <div className="character-grid">{characters.map((character, index) => <article className="character-profile" key={`${episode.id}-character-${character.name}-${index}`}><div className="character-profile-head"><div className="character-avatar"><UsersRound size={16} /></div><strong>{character.name}</strong></div><div className="character-fields"><DetailField label="人物介绍" value={character.introduction} /><DetailField label="穿着" value={character.costume} /><DetailField label="性格" value={character.personality} /><DetailField label="表情 / 状态" value={character.expressions} /><DetailField label="连续性备注" value={character.continuityNotes} /></div></article>)}</div> : <p className="empty-detail">本集未识别到参与人物</p>}</section>
      </div>}
    </div>
    <button className="icon-button small-icon" aria-label="分集更多"><MoreHorizontal size={16} /></button>
  </article>;
}
const roleLabels: Record<Subject["role"], string> = { character: "角色", location: "场景", prop: "道具" };
const SUBJECTS_PER_PAGE = 8;

function SubjectCard({ subject, generating, disabled, onGenerateImage, onDelete, onViewImage }: { subject: Subject; generating: boolean; disabled: boolean; onGenerateImage: (subject: Subject) => void; onDelete: (subject: Subject) => void; onViewImage?: (subject: Subject) => void }) {
  const viewImage = onViewImage ?? ((item: Subject) => window.dispatchEvent(new CustomEvent<Subject>("subject-image-preview", { detail: item })));
  return <article className="subject-card">
    <div className={`subject-image-slot ${subject.imageUrl ? "has-image" : ""}`}>
      {generating ? <span className="subject-image-loading"><LoaderCircle className="spin" size={22} /><small>正在生成图片</small></span> : subject.imageUrl ? <button type="button" className="subject-image" onClick={() => viewImage(subject)} aria-label={`查看${subject.name}主体图片`} title="查看主体图片"><img src={subject.imageUrl} alt={`${subject.name}主体设定图`} /><span className="subject-image-overlay"><Eye size={22} /></span></button> : <span><ImagePlus size={20} /><small>待生成图片</small></span>}
    </div>
    <div className="subject-card-main">
      <div className="subject-card-head">
        <div className="subject-title"><strong>{subject.name}</strong><span className={`role-label ${subject.role}`}>{roleLabels[subject.role]}</span></div>
        <div className="subject-card-actions"><button className="subject-image-button" onClick={() => onGenerateImage(subject)} disabled={disabled || generating} aria-label={`${subject.imageUrl ? "重新生成" : "生成"}${subject.name}的图片`} title={subject.imageUrl ? "重新生成图片" : "生成图片"}>{generating ? <LoaderCircle className="spin" size={16} /> : <ImagePlus size={16} />}</button><button className="subject-delete-button" onClick={() => onDelete(subject)} disabled={disabled || generating} aria-label={`删除主体 ${subject.name}`} title="删除主体"><Trash2 size={15} /></button></div>
      </div>
      <div className="subject-card-details"><div><span>主体描述</span><p>{subject.description || "未设定"}</p></div><div><span>主体提示词</span><p>{subject.visualPrompt || "未设定"}</p></div></div>
    </div>
  </article>;
}
function SubjectsStage({ subjects, onNext, working, generatingSubjectId, deletingSubjectId, onGenerateImage, onDeleteSubject, onViewImage }: { subjects: Subject[]; onNext: () => void; working: boolean; generatingSubjectId: string | string[] | null; deletingSubjectId: string | null; onGenerateImage: (subject: Subject) => void; onDeleteSubject: (subject: Subject) => void; onViewImage?: (subject: Subject) => void }) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(subjects.length / SUBJECTS_PER_PAGE));
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);
  const visibleSubjects = subjects.slice((page - 1) * SUBJECTS_PER_PAGE, page * SUBJECTS_PER_PAGE);
  const activeGeneratingIds = Array.isArray(generatingSubjectId) ? generatingSubjectId : generatingSubjectId ? [generatingSubjectId] : [];
  const cardDisabled = Boolean(deletingSubjectId);
  return <div className="stage-view subjects-stage"><StepHeader eyebrow="04 / SUBJECTS" title="主体资产" description="先固定故事里会反复出现的角色、场景与关键道具，保证后续画面的一致性。" action={<button className="secondary-button"><Plus size={15} /> 添加主体</button>} />{subjects.length ? <div className="subject-grid">{visibleSubjects.map((subject) => <SubjectCard key={subject.id} subject={subject} generating={activeGeneratingIds.includes(subject.id)} disabled={cardDisabled} onGenerateImage={onGenerateImage} onDelete={onDeleteSubject} onViewImage={onViewImage} />)}</div> : <div className="subject-empty"><UsersRound size={22} /><p>暂无主体资产</p><small>请返回上一阶段重新提取主体。</small></div>}{subjects.length > SUBJECTS_PER_PAGE && <nav className="subject-pagination" aria-label="主体分页"><span>第 {page} / {pageCount} 页</span><div><button className="icon-button small-icon" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} aria-label="上一页" title="上一页"><ChevronLeft size={16} /></button><button className="icon-button small-icon" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount} aria-label="下一页" title="下一页"><ChevronRight size={16} /></button></div></nav>}<div className="action-row"><span className="action-hint"><UsersRound size={15} /> {subjects.length} 个主体 · 已生成主体提示词</span><button className="primary-button" onClick={onNext} disabled={working || !subjects.length}>{working ? <LoaderCircle className="spin" size={17} /> : <ScanSearch size={17} />}提取分镜</button></div></div>;
}
function ShotsStage({ shots, subjects, episodes, jobs, onNext, onGenerateVideo, onViewVideo, working }: { shots: Shot[]; subjects: Subject[]; episodes: Episode[]; jobs: RenderJob[]; onNext: () => void; onGenerateVideo: (shot: Shot) => void; onViewVideo: (shot: Shot, url: string) => void; working: boolean }) {
  const [selectedEpisode, setSelectedEpisode] = useState(0);
  const visible = selectedEpisode ? shots.filter((shot) => shot.episodeNumber === selectedEpisode) : shots;
  const renderReferences = (shot: Shot, role: Subject["role"]) => {
    const references = subjectsMentionedInShot(shot, subjects).filter((subject) => subject.role === role && subject.imageUrl);
    return <span className="shot-reference-cell">{references.length ? references.map((subject) => <span className="shot-reference-thumb" key={subject.id} title={subject.name}><img src={subject.imageUrl!} alt={subject.name} /></span>) : <span className="shot-empty">—</span>}</span>;
  };
  const jobForShot = (shot: Shot) => jobs.find((item) => item.shotId === shot.id);
  const renderVideoResult = (shot: Shot) => {
    const job = jobForShot(shot);
    if (!job || (job.status !== "completed" && !job.outputUrl)) return null;
    if (!job.outputUrl) return <span className="shot-video-result complete">已完成</span>;
    return <span className="shot-video-output"><button className="shot-video-preview" onClick={() => onViewVideo(shot, job.outputUrl!)} aria-label={`查看第${shot.episodeNumber}集第${shot.shotOrder}个镜头视频`} title="查看视频"><video src={job.outputUrl} muted preload="metadata" /><span><Eye size={13} />查看</span></button></span>;
  };
  const renderVideoCell = (shot: Shot) => {
    const job = jobForShot(shot);
    const active = job?.status === "queued" || job?.status === "processing";
    const failed = job?.status === "failed";
    const output = renderVideoResult(shot);
    if (output) return <span className="shot-video-cell">{output}</span>;
    return <span className="shot-video-cell"><button className="shot-video-button" onClick={() => onGenerateVideo(shot)} disabled={active} aria-label={`生成第${shot.episodeNumber}集第${shot.shotOrder}个镜头视频`} title={active ? "视频生成中" : failed ? job.errorMessage || "上次生成失败，点击重试" : "生成视频"}>{active ? <LoaderCircle className="spin" size={15} /> : <Clapperboard size={15} />}</button>{active ? <span className="shot-video-progress">{job?.status === "queued" ? "生成中" : `${job?.progress ?? 0}%`}</span> : failed ? <span className="shot-video-progress failed">生成失败</span> : null}</span>;
  };
  return <div className="stage-view shots-view">
    <StepHeader eyebrow="05 / STORYBOARD" title="分镜清单" description="按集查看镜头、角色、物品和对白。确认后即可为单个镜头选择参考图并生成视频。" action={<div className="episode-tabs"><button className={selectedEpisode === 0 ? "selected" : ""} onClick={() => setSelectedEpisode(0)}>全部</button>{episodes.map((episode) => <button key={episode.id} className={selectedEpisode === episode.episodeNumber ? "selected" : ""} onClick={() => setSelectedEpisode(episode.episodeNumber)}>{formatEpisodeLabel(episode.episodeNumber)}</button>)}</div>} />
    <div className="shot-table"><div className="shot-table-head"><span>镜头</span><span>角色</span><span>物品</span><span>场景 / 动作</span><span>对白</span><span>画面提示词</span><span>时长</span><span>视频</span></div>{visible.map((shot) => <article className="shot-row" key={shot.id}>
      <span className="shot-number">E{String(shot.episodeNumber).padStart(2, "0")} · {String(shot.shotOrder).padStart(2, "0")}<strong>{shot.title.split("·").slice(1).join("·").trim()}</strong></span>
      {renderReferences(shot, "character")}
      {renderReferences(shot, "prop")}
      <span><b>{shot.location}</b><small>{shot.action}</small>{renderReferences(shot, "location")}</span>
      <span className="dialogue">{shot.dialogue || "—"}</span>
      <span className="shot-prompt">{shot.visualPrompt}</span>
      <span className="shot-duration">{shot.durationSeconds}s<i>{shot.camera}</i></span>
      {renderVideoCell(shot)}
    </article>)}</div>
    <div className="action-row"><span className="action-hint"><ScanSearch size={15} /> {shots.length} 个镜头 · 预估 {formatDuration(shots.reduce((sum, shot) => sum + shot.durationSeconds, 0))}</span><button className="primary-button" onClick={onNext} disabled={!shots.length}><Combine size={17} />视频合并</button></div>
  </div>;
}

type ShotEditInput = Pick<Shot, "location" | "action" | "visualPrompt">;

function ShotVideoPreviewDialog({ shot, url, history, onSave, onRegenerate, onClose }: { shot: Shot; url: string; history: Array<{ id: string; outputUrl: string; createdAt: string; generationPrompt: string | null }>; onSave: (input: ShotEditInput) => Promise<boolean>; onRegenerate: (prompt: string | null) => void; onClose: () => void }) {
  const [selectedUrl, setSelectedUrl] = useState(url);
  const [selectedCreatedAt, setSelectedCreatedAt] = useState(history.find((item) => item.outputUrl === url)?.createdAt ?? new Date().toISOString());
  const [duration, setDuration] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ShotEditInput>({ location: shot.location, action: shot.action, visualPrompt: shot.visualPrompt });
  const selectedGenerationPrompt = history.find((item) => item.outputUrl === selectedUrl)?.generationPrompt ?? null;
  const selectedSubmittedPrompt = submittedVideoPrompt(selectedGenerationPrompt);
  useEffect(() => { setSelectedUrl(url); setSelectedCreatedAt(history.find((item) => item.outputUrl === url)?.createdAt ?? new Date().toISOString()); }, [history, url]);
  useEffect(() => { setDraft({ location: shot.location, action: shot.action, visualPrompt: shot.visualPrompt }); }, [shot.location, shot.action, shot.visualPrompt]);
  const cancelEditing = () => { setDraft({ location: shot.location, action: shot.action, visualPrompt: shot.visualPrompt }); setEditing(false); };
  const saveEditing = async () => {
    const input = { location: draft.location.trim(), action: draft.action.trim(), visualPrompt: draft.visualPrompt.trim() };
    if (!input.location || !input.action || !input.visualPrompt) return;
    setSaving(true);
    const saved = await onSave(input);
    setSaving(false);
    if (saved) setEditing(false);
  };
  const validDraft = Boolean(draft.location.trim() && draft.action.trim() && draft.visualPrompt.trim());
  return <div className="settings-backdrop shot-video-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><section className="shot-video-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="shot-video-preview-title">
    <div className="shot-video-preview-main"><video className="shot-video-player" src={selectedUrl} controls autoPlay playsInline onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} /><div className="shot-video-history"><strong>历史视频</strong>{history.length ? history.map((item) => <button className={`shot-video-history-item ${item.outputUrl === selectedUrl ? "selected" : ""}`} type="button" key={item.id} aria-label="查看历史视频" onClick={() => { setSelectedUrl(item.outputUrl); setSelectedCreatedAt(item.createdAt); setDuration(null); }}><video src={item.outputUrl} muted preload="metadata" /></button>) : <button className="shot-video-history-item selected" type="button" aria-label="当前视频"><video src={selectedUrl} muted preload="metadata" /></button>}</div></div>
    <aside className="shot-video-preview-sidebar">
      <div className="shot-video-preview-head"><div><span className="panel-eyebrow">SHOT VIDEO</span><h2 id="shot-video-preview-title">{shot.title}</h2><p>E{String(shot.episodeNumber).padStart(2, "0")} · {String(shot.shotOrder).padStart(2, "0")}</p></div><button className="icon-button" onClick={onClose} disabled={saving} aria-label="关闭视频预览"><X size={18} /></button></div>
      <div className="shot-video-meta"><span>生成时间 <b>{new Date(selectedCreatedAt).toLocaleString("zh-CN", { hour12: false })}</b></span><span>视频时长 <b>{duration ? formatDuration(Math.round(duration)) : `${shot.durationSeconds}s`}</b></span><span>镜头信息 <b>{shot.camera} · {shot.durationSeconds}s</b></span></div>
      <section className={`shot-video-detail ${editing ? "is-editing" : ""}`}><div className="shot-video-detail-head"><span>场景与动作</span>{!editing && <button type="button" onClick={() => setEditing(true)}><Pencil size={13} />编辑</button>}</div>{editing ? <div className="shot-video-edit-fields"><label><span>场景</span><input value={draft.location} maxLength={500} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))} /></label><label><span>动作</span><textarea value={draft.action} maxLength={5000} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))} /></label></div> : <p>{shot.location} · {shot.action}</p>}</section>
      <section className={`shot-video-detail ${editing ? "is-editing" : ""}`}><div className="shot-video-detail-head"><span>分镜画面提示词</span></div>{editing ? <textarea className="shot-video-prompt-editor" value={draft.visualPrompt} maxLength={12000} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, visualPrompt: event.target.value }))} /> : <p>{shot.visualPrompt}</p>}</section>
      {!editing && <section className="shot-video-detail"><div className="shot-video-detail-head"><span>本次视频实际生成提示词</span></div><p className={`shot-video-generation-prompt ${selectedSubmittedPrompt ? "" : "is-missing"}`}>{selectedSubmittedPrompt || "该历史视频生成时尚未记录提示词；重新生成后会在这里显示本次提交的内容。"}</p>{selectedGenerationPrompt && selectedSubmittedPrompt !== selectedGenerationPrompt.trim() && <details className="shot-video-full-prompt"><summary>查看模型收到的完整提示词</summary><p>{selectedGenerationPrompt}</p></details>}</section>}
      <div className="shot-video-preview-actions">{editing ? <div className="shot-video-edit-actions"><button className="secondary-button" type="button" onClick={cancelEditing} disabled={saving}>取消</button><button className="primary-button" type="button" onClick={() => void saveEditing()} disabled={saving || !validDraft}>{saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}保存修改</button></div> : <button className="secondary-button" type="button" onClick={() => onRegenerate(selectedSubmittedPrompt)}><RefreshCw size={15} /> 重新生成</button>}</div>
    </aside>
  </section></div>;
}

function ShotVideoDialog({ shot, previousShot, subjects, videoModel, initialPrompt, busy, onGenerate, onClose }: { shot: Shot; previousShot?: Shot; subjects: Subject[]; videoModel?: VideoSettings["model"]; initialPrompt?: string | null; busy: boolean; onGenerate: (references: Subject[], model: VideoSettings["model"], duration: number, options: { prompt: string; audioMode: VideoAudioMode; speechRate: VideoSpeechRate; bgm: boolean; continuityMode: VideoContinuityMode }) => void; onClose: () => void }) {
  const referencedImageSubjects = subjectsMentionedInShot(shot, subjects).filter((subject) => Boolean(subject.imageUrl));
  const [selectedIds, setSelectedIds] = useState<string[]>(referencedImageSubjects.map((subject) => subject.id));
  const [prompt, setPrompt] = useState(() => initialPrompt?.trim() || shotVideoPrompt(shot, previousShot));
  const [model, setModel] = useState<VideoSettings["model"]>(videoModel ?? videoModelOptions[0]);
  const [duration, setDuration] = useState(String(Math.min(12, Math.max(2, shot.durationSeconds))));
  const [resolution, setResolution] = useState("720p");
  const [audioMode, setAudioMode] = useState<VideoAudioMode>(dialogueWithoutNarration(shot.dialogue) ? "dialogue" : "ambient");
  const [speechRate, setSpeechRate] = useState<VideoSpeechRate>("natural");
  const [bgm, setBgm] = useState(false);
  const [continuityMode, setContinuityMode] = useState<VideoContinuityMode>("auto");
  const contentRef = useRef<HTMLDivElement>(null);
  const [continuityPreview, setContinuityPreview] = useState<ShotContinuityPreview | null>(previousShot ? null : { status: "first-shot", previousShotId: null, tailFrameUrl: null, message: "这是本集第一个镜头，无需承接上一镜头。" });
  const [continuityPreviewLoading, setContinuityPreviewLoading] = useState(Boolean(previousShot));
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }); }, []);
  useEffect(() => {
    if (!previousShot) return;
    let active = true;
    setContinuityPreviewLoading(true);
    void api.shotContinuityPreview(shot.projectId, shot.id)
      .then((result) => { if (active) setContinuityPreview(result); })
      .catch((caught) => { if (active) setContinuityPreview({ status: "extract-failed", previousShotId: previousShot.id, tailFrameUrl: null, message: caught instanceof Error ? caught.message : "尾帧预览加载失败" }); })
      .finally(() => { if (active) setContinuityPreviewLoading(false); });
    return () => { active = false; };
  }, [previousShot, shot.id, shot.projectId]);
  const toggleReference = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const selected = referencedImageSubjects.filter((subject) => selectedIds.includes(subject.id));
  return <div className="settings-backdrop video-generation-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="settings-dialog video-generation-dialog" role="dialog" aria-modal="true" aria-labelledby="shot-video-title">
    <div className="settings-dialog-head"><div><span className="panel-eyebrow">VIDEO GENERATION</span><h2 id="shot-video-title">视频生成</h2><p>E{String(shot.episodeNumber).padStart(2, "0")} · {String(shot.shotOrder).padStart(2, "0")} · {shot.title}</p></div><button className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭视频生成"><X size={18} /></button></div>
    <div className="video-generation-content" ref={contentRef}>
      <section className="video-generation-section"><span className="image-field-label">参考图 <small>仅显示当前镜头已引用的主体图片</small></span><div className="video-reference-grid">{referencedImageSubjects.map((subject) => <button type="button" key={subject.id} className={`video-reference-card ${selectedIds.includes(subject.id) ? "selected" : ""}`} onClick={() => toggleReference(subject.id)} disabled={busy}><img src={subject.imageUrl!} alt={subject.name} /><span>{subject.name}</span>{selectedIds.includes(subject.id) && <Check size={14} />}</button>)}{!referencedImageSubjects.length && <div className="video-reference-empty">当前镜头暂无已引用的主体图片。</div>}</div><small className="video-reference-count">已选择 {selected.length} 张参考图</small></section>
      <section className="video-generation-section continuity-preview-section"><span className="image-field-label">上一镜头尾帧 <small>{previousShot ? `E${String(previousShot.episodeNumber).padStart(2, "0")} · ${String(previousShot.shotOrder).padStart(2, "0")} · ${previousShot.title}` : "本集首镜头"}</small></span><div className={`continuity-preview ${continuityPreview?.tailFrameUrl ? "has-frame" : ""}`}>{continuityPreviewLoading ? <><LoaderCircle className="spin" size={20} /><span>正在截取上一镜头稳定尾帧</span></> : continuityPreview?.tailFrameUrl ? <><img src={continuityPreview.tailFrameUrl} alt="上一镜头稳定尾帧" /><div><strong>此画面将用于动作续接</strong><small>{continuityPreview.message}</small></div></> : <><Film size={20} /><span>{continuityPreview?.message ?? "暂时无法读取上一镜头尾帧。"}</span></>}</div></section>
      <section className="video-generation-section"><span className="image-field-label">镜头衔接</span><div className="video-tabs continuity-tabs" role="group" aria-label="镜头衔接方式">{([
        ["auto", "智能"], ["continue", "动作续接"], ["cut", "直接切镜"], ["scene", "场景切换"],
      ] as Array<[VideoContinuityMode, string]>).map(([value, label]) => <button type="button" key={value} className={continuityMode === value ? "selected" : ""} disabled={busy} onClick={() => setContinuityMode(value)}>{label}</button>)}</div></section>
      <label className="video-generation-section prompt-section"><span className="image-field-label">视频提示词 <b>*</b></span><textarea value={prompt} maxLength={16000} disabled={busy} onChange={(event) => setPrompt(event.target.value)} /><small className="prompt-count">{prompt.length} / 16000</small></label>
      <div className="image-control image-model-control"><span>模型</span><SmoothSelect value={model} options={videoModelOptions.map((value) => ({ value, label: videoModelLabels[value] }))} disabled={busy} ariaLabel="视频模型" onChange={(value) => setModel(value as VideoSettings["model"])} /></div>
      <div className="image-parameter-grid video-parameter-grid"><div className="image-control"><span>分辨率</span><SmoothSelect value={resolution} options={[{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }]} disabled={busy} ariaLabel="视频分辨率" onChange={setResolution} /></div><label className="image-control video-duration-control"><span>时长 <small>2 - 12 秒</small></span><div className="video-duration-input"><input type="number" min={2} max={12} step={1} value={duration} disabled={busy} aria-label="自定义视频时长" onChange={(event) => setDuration(event.target.value.replace(/[^0-9]/g, ""))} /><b>秒</b></div></label></div>
      <div className="image-parameter-grid video-audio-grid"><div className="image-control"><span>声音内容</span><SmoothSelect value={audioMode} options={[{ value: "dialogue", label: "原文对白 / 内心 OS" }, { value: "ambient", label: "仅环境音" }, { value: "silent", label: "无声" }]} disabled={busy} ariaLabel="声音内容" onChange={(value) => setAudioMode(value as VideoAudioMode)} /></div><div className="image-control"><span>说话语速</span><SmoothSelect value={speechRate} options={[{ value: "natural", label: "自然" }, { value: "slow", label: "舒缓" }]} disabled={busy || audioMode !== "dialogue"} ariaLabel="说话语速" onChange={(value) => setSpeechRate(value as VideoSpeechRate)} /></div></div>
      <div className="video-toggle-grid single"><button type="button" className={`video-toggle ${bgm ? "on" : ""}`} onClick={() => setBgm((current) => !current)} disabled={audioMode === "silent"}><span>背景音乐</span><i /></button></div>
      <p className="video-generation-note">智能模式会在同机位动作续接时使用上一段稳定尾帧；换机位直接切镜，换地点直接进入新场景。</p>
    </div>
    <button className="primary-button image-create-button" onClick={() => onGenerate(selected, model, Math.min(12, Math.max(2, Number(duration) || 10)), { prompt: prompt.trim(), audioMode, speechRate, bgm: audioMode !== "silent" && bgm, continuityMode })} disabled={busy || !prompt.trim() || Number(duration) < 2 || Number(duration) > 12}>{busy ? <LoaderCircle className="spin" size={18} /> : <Clapperboard size={18} />} {busy ? "视频生成中" : "创作视频"}</button>
  </section></div>;
}
function RenderStage({ project, shots, jobs, onCoverCreated, onBack }: { project: Project | null; shots: Shot[]; jobs: RenderJob[]; onCoverCreated: (coverUrl: string) => void; onBack: () => void }) {
  const orderedShots = useMemo(() => [...shots].sort((left, right) => left.episodeNumber - right.episodeNumber || left.shotOrder - right.shotOrder), [shots]);
  const latestVideoByShot = useMemo(() => {
    const result = new Map<string, RenderJob>();
    jobs
      .filter((job) => job.projectId === project?.id && job.shotId && job.status === "completed" && job.outputUrl)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .forEach((job) => { if (job.shotId && !result.has(job.shotId)) result.set(job.shotId, job); });
    return result;
  }, [jobs, project?.id]);
  const availableShotIds = useMemo(() => orderedShots.filter((shot) => latestVideoByShot.has(shot.id)).map((shot) => shot.id), [latestVideoByShot, orderedShots]);
  const availableShots = useMemo(() => orderedShots.filter((shot) => latestVideoByShot.has(shot.id)), [latestVideoByShot, orderedShots]);
  const availableSignature = availableShotIds.join("|");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [merges, setMerges] = useState<VideoMerge[]>([]);
  const [selectedMergeId, setSelectedMergeId] = useState<string | null>(null);
  const [loadingMerges, setLoadingMerges] = useState(true);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState("");
  const knownAvailableIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const available = new Set(availableShotIds);
    setSelectedIds((current) => {
      const kept = current.filter((id) => available.has(id));
      const added = availableShotIds.filter((id) => !knownAvailableIds.current.has(id));
      return [...new Set([...kept, ...added])];
    });
    knownAvailableIds.current = available;
  }, [availableSignature]);

  useEffect(() => {
    let mounted = true;
    setLoadingMerges(true);
    setMergeError("");
    if (!project) {
      setMerges([]);
      setLoadingMerges(false);
      return () => { mounted = false; };
    }
    void api.videoMerges(project.id)
      .then((records) => { if (mounted) { setMerges(records); setSelectedMergeId((current) => records.some((item) => item.id === current) ? current : records[0]?.id ?? null); if (records[0]?.coverUrl) onCoverCreated(records[0].coverUrl); } })
      .catch((caught) => { if (mounted) setMergeError(caught instanceof Error ? caught.message : "合成记录读取失败"); })
      .finally(() => { if (mounted) setLoadingMerges(false); });
    return () => { mounted = false; };
  }, [project?.id]);

  const selectedSet = new Set(selectedIds);
  const selectedShots = orderedShots.filter((shot) => selectedSet.has(shot.id) && latestVideoByShot.has(shot.id));
  const selectedDuration = selectedShots.reduce((sum, shot) => sum + shot.durationSeconds, 0);
  const selectedMerge = merges.find((item) => item.id === selectedMergeId) ?? merges[0] ?? null;
  const allSelected = availableShotIds.length > 0 && availableShotIds.every((id) => selectedSet.has(id));
  const toggleShot = (shotId: string) => setSelectedIds((current) => current.includes(shotId) ? current.filter((id) => id !== shotId) : [...current, shotId]);
  const toggleAll = () => setSelectedIds(allSelected ? [] : availableShotIds);
  const mergeSelected = async () => {
    if (!project || selectedShots.length < 2 || merging) return;
    setMerging(true);
    setMergeError("");
    try {
      const result = await api.mergeVideos(project.id, selectedShots.map((shot) => shot.id));
      setMerges((current) => [result, ...current.filter((item) => item.id !== result.id)]);
      setSelectedMergeId(result.id);
      if (result.coverUrl) onCoverCreated(result.coverUrl);
    } catch (caught) {
      setMergeError(caught instanceof Error ? caught.message : "视频合并失败");
    } finally {
      setMerging(false);
    }
  };

  return <div className="stage-view render-view">
    <StepHeader eyebrow="06 / VIDEO MERGE" title="视频合成" description="勾选已经生成完成的镜头，系统会按故事板顺序合并为一个视频。" action={<span className="engine-tag"><i /> LOCAL VIDEO MERGE</span>} />
    <div className="render-preview">
      <section className="merge-preview" aria-label="合成视频预览">
        {selectedMerge ? <video key={selectedMerge.id} src={selectedMerge.outputUrl} poster={selectedMerge.coverUrl || project?.coverUrl || undefined} controls preload="metadata" /> : <div className="merge-preview-empty">{loadingMerges ? <LoaderCircle className="spin" size={24} /> : <Combine size={28} />}<strong>{loadingMerges ? "正在读取合成结果" : "还没有合成视频"}</strong><span>{loadingMerges ? "请稍候" : "从右侧选择至少两个已有视频的镜头开始合并"}</span></div>}
        <div className="merge-preview-bar"><div><span>{selectedMerge ? "MERGED VIDEO" : "VIDEO PREVIEW"}</span><strong>{project?.title ?? "未命名项目"}</strong>{selectedMerge && <small>{selectedMerge.shotIds.length} 个镜头 · {formatDuration(selectedMerge.durationSeconds)} · {new Date(selectedMerge.createdAt).toLocaleString("zh-CN", { hour12: false })}</small>}</div>{selectedMerge && <a className="secondary-button merge-download" href={selectedMerge.outputUrl} download={`${project?.title || "合成视频"}.mp4`}><Download size={16} />导出视频</a>}</div>
        {!!merges.length && <div className="merge-history"><div className="merge-history-head"><strong>合并历史</strong><span>{merges.length} 个版本</span></div><div className="merge-history-list">{merges.map((merge, index) => <button type="button" key={merge.id} className={`merge-history-item ${merge.id === selectedMerge?.id ? "selected" : ""}`} onClick={() => setSelectedMergeId(merge.id)}><span className="merge-history-thumb">{merge.coverUrl ? <img src={merge.coverUrl} alt="" /> : <Film size={17} />}</span><span><strong>版本 {String(merges.length - index).padStart(2, "0")}</strong><small>{merge.shotIds.length} 个镜头 · {formatDuration(merge.durationSeconds)}</small><time>{new Date(merge.createdAt).toLocaleString("zh-CN", { hour12: false })}</time></span></button>)}</div></div>}
      </section>
      <aside className="render-settings merge-shot-panel">
        <div className="settings-heading"><ListChecks size={16} /> 视频镜头选择</div>
        <div className="merge-select-toolbar"><span>已生成 {availableShots.length} 个镜头</span><button type="button" className="text-button" onClick={toggleAll} disabled={!availableShotIds.length}>{allSelected ? "取消全选" : "全选"}</button></div>
        <div className="merge-shot-list">
          {availableShots.map((shot) => {
            const videoJob = latestVideoByShot.get(shot.id)!;
            const selected = selectedSet.has(shot.id);
            return <label key={shot.id} className={`merge-shot-item ${selected ? "selected" : ""}`}>
              <input type="checkbox" checked={selected} disabled={merging} onChange={() => toggleShot(shot.id)} />
              <span className="merge-shot-check">{selected && <Check size={12} />}</span>
              <span className="merge-shot-thumb"><video src={videoJob.outputUrl!} muted preload="metadata" /></span>
              <span className="merge-shot-copy"><strong>E{String(shot.episodeNumber).padStart(2, "0")} · {String(shot.shotOrder).padStart(2, "0")} {shot.title}</strong><small>{formatDuration(shot.durationSeconds)} · 已生成</small></span>
            </label>;
          })}
          {!availableShots.length && <div className="merge-list-empty">还没有生成完成的视频镜头。</div>}
        </div>
        <div className="render-summary"><span>已选镜头 <b>{selectedShots.length}</b></span><span>合计时长 <b>{formatDuration(selectedDuration)}</b></span></div>
        {mergeError && <div className="merge-error">{mergeError}</div>}
        <button className="primary-button merge-submit" onClick={() => void mergeSelected()} disabled={selectedShots.length < 2 || merging}>{merging ? <LoaderCircle className="spin" size={17} /> : <Combine size={17} />}{merging ? "正在合并视频" : "合并所选镜头"}</button>
        <button className="secondary-button merge-back" onClick={onBack} disabled={merging}><ArrowLeft size={17} />返回分镜</button>
      </aside>
    </div>
    <p className="merge-footer-note">合并只使用已生成的视频，不会再次消耗生成额度。</p>
  </div>;
}
function Inspector({ stage, project, pipeline }: { stage: Stage; project: Project | null; pipeline: PipelineData }) { const labels: Record<Stage, string> = { setup: "项目设定", format: "格式化结果", episodes: "剧本解析", subjects: "主体结果", shots: "故事板结果", render: "合成结果" }; return <aside className="inspector"><div className="inspector-head"><span>当前产物</span><button className="icon-button"><MoreHorizontal size={17} /></button></div><div className="inspector-title"><span className="inspector-icon"><Sparkles size={16} /></span><div><strong>{labels[stage]}</strong><small>{project?.title ?? "尚未创建项目"}</small></div></div><div className="inspector-stats"><div><span>进度</span><b>{project?.progress ?? 0}%</b></div><div><span>分集</span><b>{pipeline.episodes.length || "—"}</b></div><div><span>镜头</span><b>{pipeline.shots.length || "—"}</b></div></div><div className="inspector-section"><span className="section-label">流水线状态</span>{stages.slice(1).map((item) => { const ready = item.id === "format" ? Boolean(pipeline.document) : item.id === "episodes" ? pipeline.episodes.length > 0 : item.id === "subjects" ? pipeline.subjects.length > 0 : item.id === "shots" || item.id === "render" ? pipeline.shots.length > 0 : false; return <div className="status-line" key={item.id}><span className={ready ? "status-check ready" : "status-check"}>{ready && <Check size={11} />}</span><span>{item.label}</span><small>{ready ? "已完成" : "待处理"}</small></div>; })}</div><div className="inspector-tip"><Sparkles size={15} /><p>分集、主体和分镜会调用 DeepSeek v4 Flash；未配置 Key 时会阻止模型步骤，不生成示例结果。</p></div></aside>; }

function SubjectImagePreviewDialog({ subject, onClose }: { subject: Subject; onClose: () => void }) {
  return <div className="settings-backdrop subject-image-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="settings-dialog subject-image-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="subject-image-preview-title">
    <div className="settings-dialog-head"><div><span className="panel-eyebrow">SUBJECT IMAGE</span><h2 id="subject-image-preview-title">主体图片</h2><p>{subject.name}</p></div><button className="icon-button" onClick={onClose} aria-label="关闭主体图片预览"><X size={18} /></button></div>
    <img className="subject-image-preview" src={subject.imageUrl ?? ""} alt={`${subject.name}主体设定图`} />
  </section></div>;
}

function SubjectImageDialog({ subject, draft, configured, busy, onDraftChange, onReference, onGenerate, onConfigure, onClose }: { subject: Subject; draft: SubjectImageDraft; configured: boolean | undefined; busy: boolean; onDraftChange: React.Dispatch<React.SetStateAction<SubjectImageDraft>>; onReference: (file: File | undefined) => void; onGenerate: () => void; onConfigure: () => void; onClose: () => void }) {
  const role = roleLabels[subject.role];
  const modelOptions = imageModelOptions.includes(draft.model) ? imageModelOptions : [draft.model, ...imageModelOptions].filter(Boolean);
  return <div className="settings-backdrop image-generation-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="settings-dialog image-generation-dialog" role="dialog" aria-modal="true" aria-labelledby="subject-image-title">
    <div className="settings-dialog-head"><div><span className="panel-eyebrow">AI IMAGE GENERATION</span><h2 id="subject-image-title">{role}图片生成</h2><p>{subject.name}</p></div><button className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭图片生成"><X size={18} /></button></div>
    <div className="image-generation-content">
      <div className="image-generation-section"><span className="image-field-label">参考图 <small>可选，需模型支持</small></span><div className="reference-row"><label className={`reference-upload ${draft.referenceImage ? "has-preview" : ""}`}><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { onReference(event.target.files?.[0]); event.target.value = ""; }} />{draft.referenceImage ? <img src={draft.referenceImage} alt="参考图预览" /> : <><ImagePlus size={21} /><strong>添加参考图</strong><small>PNG / JPG / WEBP</small></>}</label>{draft.referenceImage && <div className="reference-meta"><strong>{draft.referenceName}</strong><small>生成时会随提示词一起提交</small><button className="text-button" onClick={() => onDraftChange((current) => ({ ...current, referenceImage: undefined, referenceName: "" }))} disabled={busy}>移除</button></div>}</div></div>
      <label className="image-generation-section prompt-section"><span className="image-field-label">提示词 <b>*</b></span><textarea value={draft.prompt} maxLength={12000} disabled={busy} onChange={(event) => onDraftChange((current) => ({ ...current, prompt: event.target.value }))} /><small className="prompt-count">{draft.prompt.length} / 12000</small></label>
      <div className="image-control image-model-control"><span>模型</span><SmoothSelect value={draft.model} options={modelOptions.map((model) => ({ value: model, label: model }))} disabled={busy} ariaLabel="模型" onChange={(value) => onDraftChange((current) => ({ ...current, model: value }))} /></div>
      <div className="image-parameter-grid"><div className="image-control"><span>分辨率</span><SmoothSelect value={draft.resolution} options={[{ value: "2K", label: "2K" }, { value: "4K", label: "4K" }]} disabled={busy} ariaLabel="分辨率" onChange={(value) => onDraftChange((current) => ({ ...current, resolution: value as ImageResolution }))} /></div><div className="image-control"><span>画面比例</span><SmoothSelect value={draft.aspectRatio} options={imageRatioOptions} disabled={busy} ariaLabel="画面比例" onChange={(value) => onDraftChange((current) => ({ ...current, aspectRatio: value as ImageAspectRatio }))} /></div><div className="image-control image-count-control"><span>数量</span><strong>1 张</strong></div></div>
      <div className="image-generation-summary"><span>输出尺寸 <strong>{imageSizeLabels[draft.resolution][draft.aspectRatio]}</strong></span><span>保存位置 <code>backend/data/generated/subjects</code></span></div>
      {configured === false && <div className="image-config-warning"><span>尚未配置图片平台 API Key</span><button className="text-button" onClick={onConfigure}>前往模型设置</button></div>}
    </div>
    <button className="primary-button image-create-button" onClick={onGenerate} disabled={busy || configured !== true || draft.prompt.trim().length < 10 || !draft.model.trim()}>{busy ? <LoaderCircle className="spin" size={18} /> : <ImagePlus size={18} />}{busy ? "正在生成图片" : "生成图片"}</button>
  </section></div>;
}

function ApiKeyInput({ value, placeholder, ariaLabel, onChange }: { value: string; placeholder: string; ariaLabel: string; onChange: (value: string) => void }) {
  const [visible, setVisible] = useState(false);
  const toggleLabel = `${visible ? "隐藏" : "显示"}${ariaLabel}`;
  return <div className="settings-key-input">
    <input type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={ariaLabel} autoComplete="off" />
    <button type="button" aria-label={toggleLabel} title={toggleLabel} onClick={() => setVisible((current) => !current)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
  </div>;
}

function SettingsDialog({ settings, imageSettings, videoSettings, draft, imageDraft, videoDraft, busy, onDraftChange, onImageDraftChange, onVideoDraftChange, onSave, onClose }: { settings: LlmSettings | null; imageSettings: ImageSettings | null; videoSettings: VideoSettings | null; draft: string; imageDraft: ImageSettingsDraft; videoDraft: VideoSettingsDraft; busy: boolean; onDraftChange: (value: string) => void; onImageDraftChange: React.Dispatch<React.SetStateAction<ImageSettingsDraft>>; onVideoDraftChange: React.Dispatch<React.SetStateAction<VideoSettingsDraft>>; onSave: () => void; onClose: () => void }) {
  const changeImageProvider = (provider: ImageSettings["provider"]) => onImageDraftChange((current) => ({ ...current, provider, apiBase: imageProviderDefaults[provider] }));
  const changeVideoProvider = (provider: VideoSettings["provider"]) => onVideoDraftChange((current) => ({ ...current, provider, apiBase: imageProviderDefaults[provider] }));
  const configuredModelOptions = imageModelOptions.includes(imageDraft.model) ? imageModelOptions : [imageDraft.model, ...imageModelOptions].filter(Boolean);
  return <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="settings-dialog model-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="settings-dialog-head"><div><span className="panel-eyebrow">MODEL SETTINGS</span><h2 id="settings-title">模型配置</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭模型设置"><X size={18} /></button></div>{busy && !settings && !imageSettings ? <div className="settings-loading"><LoaderCircle className="spin" size={19} />正在读取本地配置</div> : <div className="model-settings-content">
    <section className="model-settings-section"><div className="model-settings-heading"><div><strong>剧本处理</strong><small>DEEPSEEK</small></div><span className={`compact-config-state ${settings?.configured ? "configured" : ""}`}>{settings?.configured ? "已配置" : "未配置"}</span></div><div className="settings-field"><span>API Key</span><ApiKeyInput value={draft} onChange={onDraftChange} placeholder={settings?.configured ? "已配置，输入新 Key 可替换" : "粘贴 DeepSeek API Key"} ariaLabel="剧本处理 API Key" /></div><div className="settings-field-row"><label className="settings-field">模型<input value={settings?.model ?? "deepseek-v4-flash"} readOnly /></label><label className="settings-field">API 地址<input value={settings?.apiBase ?? "https://api.deepseek.com"} readOnly /></label></div></section>
    <section className="model-settings-section"><div className="model-settings-heading"><div><strong>主体图片</strong><small>OPENAI COMPATIBLE</small></div><span className={`compact-config-state ${imageSettings?.configured ? "configured" : ""}`}>{imageSettings?.configured ? "已配置" : "未配置"}</span></div><div className="settings-field-row"><div className="settings-field"><span>平台</span><SmoothSelect value={imageDraft.provider} options={[{ value: "volcengine", label: "火山方舟" }, { value: "aliyun", label: "阿里云百炼" }, { value: "openai", label: "OpenAI 官方" }, { value: "custom", label: "自定义兼容平台" }]} disabled={busy} ariaLabel="平台" onChange={(value) => changeImageProvider(value as ImageSettings["provider"])} /></div><div className="settings-field"><span>API Key</span><ApiKeyInput value={imageDraft.apiKey} onChange={(value) => onImageDraftChange((current) => ({ ...current, apiKey: value }))} placeholder={imageSettings?.configured ? "已配置，输入新 Key 可替换" : "填写图片平台 API Key"} ariaLabel="图片平台 API Key" /></div></div><div className="settings-field"><span>模型</span><SmoothSelect value={imageDraft.model} options={configuredModelOptions.map((model) => ({ value: model, label: model }))} disabled={busy} ariaLabel="图片模型" onChange={(value) => onImageDraftChange((current) => ({ ...current, model: value }))} /></div><label className="settings-field">API 地址<input value={imageDraft.apiBase} onChange={(event) => onImageDraftChange((current) => ({ ...current, apiBase: event.target.value }))} placeholder="https://.../v1" /></label></section>
    <section className="model-settings-section"><div className="model-settings-heading"><div><strong>视频生成</strong><small>VIDEO API</small></div><span className={`compact-config-state ${videoSettings?.configured ? "configured" : ""}`}>{videoSettings?.configured ? "已配置" : "未配置"}</span></div><div className="settings-field-row"><div className="settings-field"><span>平台</span><SmoothSelect value={videoDraft.provider} options={[{ value: "volcengine", label: "火山方舟" }, { value: "aliyun", label: "阿里云百炼" }, { value: "openai", label: "OpenAI 官方" }, { value: "custom", label: "自定义兼容平台" }]} disabled={busy} ariaLabel="视频平台" onChange={(value) => changeVideoProvider(value as VideoSettings["provider"])} /></div><div className="settings-field"><span>API Key</span><ApiKeyInput value={videoDraft.apiKey} onChange={(value) => onVideoDraftChange((current) => ({ ...current, apiKey: value }))} placeholder={videoSettings?.configured ? "已配置，输入新 Key 可替换" : "填写视频平台 API Key"} ariaLabel="视频平台 API Key" /></div></div><div className="settings-field"><span>模型</span><SmoothSelect value={videoDraft.model} options={videoModelOptions.map((model) => ({ value: model, label: videoModelLabels[model] }))} disabled={busy} ariaLabel="视频模型" onChange={(value) => onVideoDraftChange((current) => ({ ...current, model: value as VideoSettings["model"] }))} /></div><label className="settings-field">API 地址<input value={videoDraft.apiBase} onChange={(event) => onVideoDraftChange((current) => ({ ...current, apiBase: event.target.value }))} placeholder="https://.../v1" /></label></section>
    <p className="settings-note">密钥仅保存在本机后端的 <code>backend/.env</code>。默认使用 Seedream 生图模型；也可以配置当前平台支持的其他 OpenAI 兼容图片模型。</p><div className="settings-actions"><button className="primary-button" onClick={onSave} disabled={busy || !imageDraft.model.trim() || !imageDraft.apiBase.trim()}>{busy ? "保存中..." : "保存配置"}</button></div></div>}</section></div>;
}
export default App;
