import { createContext, DragEvent, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  AudioLines,
  BookOpenText,
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  Clapperboard,
  Combine,
  FileUp,
  Film,
  Focus,
  FolderOpen,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  ListTree,
  LoaderCircle,
  MapPin,
  MessageSquarePlus,
  MessageSquareText,
  Package,
  Play,
  Plus,
  Search,
  ScanSearch,
  Trash2,
  Type,
  Undo2,
  Redo2,
  UserRound,
  Users,
  Video,
  WandSparkles,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { api } from "./api";
import type { AssetLibraryItem, Episode, ImageSettings, RenderJob, Shot, Subject, VideoSettings } from "./types";

type CanvasNodeKind = "note" | "text" | "image" | "video" | "audio" | "character" | "scene" | "prop" | "prompt" | "script" | "formattedScript" | "episodes" | "subjects" | "shot" | "shotItem" | "merge" | "media";
type CanvasOperation = "format-script" | "extract-episodes" | "extract-subjects" | "generate-subject-images" | "extract-shots" | "render-videos" | "merge-videos";
type CanvasRunState = "idle" | "running" | "success" | "error";
type CanvasNodeData = {
  kind: CanvasNodeKind;
  label: string;
  description: string;
  meta?: string;
  thumbnailUrl?: string | null;
  mediaUrl?: string | null;
  mediaType?: AssetLibraryItem["mediaType"];
  source?: "template" | "asset" | "manual" | "generated";
  operation?: CanvasOperation;
  runState?: CanvasRunState;
  statusMessage?: string;
  projectId?: string;
  pipelineRoot?: string;
  generatedBy?: string;
  entityId?: string;
} & Record<string, unknown>;
type CanvasNode = Node<CanvasNodeData, "canvasCard">;
type SavedCanvas = { nodes: CanvasNode[]; edges: Edge[] };
type DragPayload = Partial<CanvasNodeData> & { kind: CanvasNodeKind };
type ShotSubjectReference = { id: string; name: string; imageUrl: string | null; kind: "character" | "scene" | "prop" };

const STORAGE_KEY = "script-master-infinite-canvas-v1";
const dragMime = "application/x-script-master-canvas-node";
const builtInSubjectStyles = ["电影写实", "日系动漫", "吉卜力治愈手绘", "赛博朋克动漫"];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripCanvasSubjectStyle(value: string, additionalStyle = "") {
  const styles = Array.from(new Set([...builtInSubjectStyles, additionalStyle.trim()].filter(Boolean)))
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp);
  const stylePattern = `(?:${styles.join("|")})(?:风格)?`;
  return value
    .replace(new RegExp(`视觉风格\\s*[：:]\\s*${stylePattern}[，,。；;：:]?\\s*`, "gi"), "")
    .replace(new RegExp(`${stylePattern}[，,。；;：:]?\\s*`, "gi"), "")
    .replace(/^[，,。；;：:\s]+/, "")
    .replace(/[，,]{2,}/g, "，")
    .trim();
}

const kindMeta: Record<CanvasNodeKind, { label: string; icon: LucideIcon; color: string }> = {
  note: { label: "通用", icon: Box, color: "#8a9099" },
  text: { label: "文本", icon: Type, color: "#5a9ab8" },
  image: { label: "图片", icon: ImageIcon, color: "#58a67a" },
  video: { label: "视频", icon: Video, color: "#c06972" },
  audio: { label: "音频", icon: AudioLines, color: "#b17ac5" },
  character: { label: "角色", icon: UserRound, color: "#e76b61" },
  scene: { label: "场景", icon: MapPin, color: "#4e9f76" },
  prop: { label: "道具", icon: Package, color: "#ca8b3e" },
  prompt: { label: "提示词", icon: MessageSquareText, color: "#7a76c8" },
  script: { label: "剧本", icon: BookOpenText, color: "#d4ad19" },
  formattedScript: { label: "格式化剧本", icon: BookOpenText, color: "#d4ad19" },
  episodes: { label: "分集", icon: ListTree, color: "#c79a52" },
  subjects: { label: "主体", icon: Users, color: "#c87066" },
  shot: { label: "分镜", icon: Clapperboard, color: "#4d88c7" },
  shotItem: { label: "镜头", icon: Film, color: "#4d88c7" },
  merge: { label: "合成", icon: Combine, color: "#db806c" },
  media: { label: "媒体", icon: Video, color: "#a260a8" },
};

const nodeGroups: Array<{ label: string; kinds: CanvasNodeKind[] }> = [
  { label: "基础节点", kinds: ["note", "text", "image", "video", "audio"] },
  { label: "素材节点", kinds: ["character", "scene", "prop", "prompt"] },
  { label: "流程节点", kinds: ["script", "subjects", "shot", "merge"] },
];

const defaultOperationByKind: Partial<Record<CanvasNodeKind, CanvasOperation>> = {
  script: "format-script",
  episodes: "extract-episodes",
  subjects: "extract-subjects",
  shot: "extract-shots",
  merge: "merge-videos",
};

const operationMeta: Record<CanvasOperation, { label: string; running: string }> = {
  "format-script": { label: "剧本格式化", running: "正在格式化剧本" },
  "extract-episodes": { label: "开始智能分集", running: "正在拆分剧集" },
  "extract-subjects": { label: "提取角色场景道具", running: "正在提取主体" },
  "generate-subject-images": { label: "生成全部主体图片", running: "正在生成主体图片" },
  "extract-shots": { label: "生成完整分镜", running: "正在生成分镜" },
  "render-videos": { label: "生成全部镜头视频", running: "正在生成镜头视频" },
  "merge-videos": { label: "合成最终成片", running: "正在合成视频" },
};

type CanvasRuntimeValue = {
  runNode: (nodeId: string) => void;
  runFormattedEpisodes: (nodeId: string) => void;
  runEpisodeSubjects: (nodeId: string) => void;
  runEpisodeShots: (nodeId: string) => void;
  generateSubjectImage: (nodeId: string) => void;
  generateShotVideo: (nodeId: string) => void;
  deleteNode: (nodeId: string) => void;
  imageModel: string;
  imageModelOptions: string[];
  videoModel: VideoSettings["model"];
  videoModelOptions: VideoSettings["model"][];
};

const CanvasRuntimeContext = createContext<CanvasRuntimeValue | null>(null);

const defaultNodes: CanvasNode[] = [
  { id: "sample-character", type: "canvasCard", position: { x: 60, y: 70 }, data: { kind: "character", label: "林夏", description: "短发，深色风衣，冷静克制。", meta: "主角 · 形象锁定", source: "template" } },
  { id: "sample-scene", type: "canvasCard", position: { x: 60, y: 270 }, data: { kind: "scene", label: "雨夜车站", description: "废弃站台，潮湿地面反射冷白灯光。", meta: "外景 · 夜", source: "template" } },
  { id: "sample-prompt", type: "canvasCard", position: { x: 370, y: 70 }, data: { kind: "prompt", label: "镜头提示词", description: "中景跟拍，人物缓慢走向站台尽头，雨丝清晰，电影写实。", meta: "16:9 · 6 秒", source: "template" } },
  { id: "sample-shot", type: "canvasCard", position: { x: 690, y: 170 }, data: { kind: "shot", label: "镜头 01", description: "林夏进入雨夜车站，在长椅旁停下。", meta: "中景 · 缓慢推进", source: "template" } },
  { id: "sample-media", type: "canvasCard", position: { x: 1010, y: 170 }, data: { kind: "video", label: "生成结果", description: "连接分镜后可继续扩展视频版本。", meta: "等待生成", mediaType: "video", source: "template" } },
];

const defaultEdges: Edge[] = [
  { id: "sample-character-shot", source: "sample-character", target: "sample-shot", type: "default", markerEnd: { type: MarkerType.ArrowClosed } },
  { id: "sample-scene-shot", source: "sample-scene", target: "sample-shot", type: "default", markerEnd: { type: MarkerType.ArrowClosed } },
  { id: "sample-prompt-shot", source: "sample-prompt", target: "sample-shot", type: "default", markerEnd: { type: MarkerType.ArrowClosed } },
  { id: "sample-shot-media", source: "sample-shot", target: "sample-media", type: "default", markerEnd: { type: MarkerType.ArrowClosed } },
];

function readSavedCanvas(): SavedCanvas {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { nodes: defaultNodes, edges: defaultEdges };
    const parsed = JSON.parse(raw) as Partial<SavedCanvas>;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return { nodes: defaultNodes, edges: defaultEdges };
    return {
      nodes: parsed.nodes.map((node) => {
        const generatedSubject = node.data.source === "generated" && ["character", "scene", "prop"].includes(node.data.kind);
        const savedStyle = typeof node.data.imageStyle === "string" ? node.data.imageStyle : "";
        const recoveredData = {
          ...node.data,
          ...(generatedSubject ? { description: stripCanvasSubjectStyle(node.data.description, savedStyle) } : {}),
          ...(node.data.runState === "running"
            ? { runState: "error" as const, statusMessage: "上次执行被中断，请重新运行" }
            : {}),
          ...(node.data.episodeRunState === "running"
            ? { episodeRunState: "error" as const, episodeStatusMessage: "上次分集被中断，请重新运行" }
            : {}),
          ...(node.data.subjectRunState === "running"
            ? { subjectRunState: "error" as const, subjectStatusMessage: "上次主体提取被中断，请重新运行" }
            : {}),
          ...(node.data.shotRunState === "running"
            ? { shotRunState: "error" as const, shotStatusMessage: "上次分镜生成被中断，请重新运行" }
            : {}),
          ...(node.data.videoRunState === "running"
            ? { videoRunState: "error" as const, videoStatusMessage: "上次视频生成被中断，请重新生成" }
            : {}),
        };
        const data = recoveredData.kind === "script" && !recoveredData.operation
          ? { ...recoveredData, operation: "format-script" as const, runState: recoveredData.runState ?? "idle" as const, statusMessage: recoveredData.statusMessage || "输入剧本后开始格式化" }
          : recoveredData;
        return { ...node, data };
      }),
      edges: parsed.edges.map((edge) => ({ ...edge, type: "default" })),
    };
  } catch {
    return { nodes: defaultNodes, edges: defaultEdges };
  }
}

const shotScales = ["远景", "全景", "中景", "近景", "特写"];
const shotMoves = ["固定", "推进", "拉远", "横移", "跟拍"];
const shotDurations = ["3 秒", "5 秒", "8 秒"];
const shotRatios = ["16:9", "9:16", "1:1"];
const subjectStyleOptions = [...builtInSubjectStyles, "自定义风格"];
const defaultSubjectImageModels = ["doubao-seedream-5-0-pro-260628", "doubao-seedream-4-0-250828"];
const defaultVideoModels: VideoSettings["model"][] = ["doubao-seedance-2-0-mini-260615", "doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128"];
const videoModelLabels: Record<VideoSettings["model"], string> = {
  "doubao-seedance-2-0-mini-260615": "Seedance 2.0 Mini",
  "doubao-seedance-2-0-260128": "Seedance 2.0",
  "doubao-seedance-2-0-fast-260128": "Seedance 2.0 Fast",
};

function nodeString(data: CanvasNodeData, key: string, fallback: string) {
  const value = data[key];
  return typeof value === "string" && value ? value : fallback;
}

function CanvasChoiceRow({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (value: string) => void }) {
  return <div className="infinite-creative-choice nodrag nowheel">
    <span>{label}</span>
    <div>{options.map((option) => <button type="button" aria-pressed={value === option} className={value === option ? "selected" : ""} key={option} onClick={() => onChange(option)}>{option}</button>)}</div>
  </div>;
}

function CanvasSelect({ value, options, onChange, ariaLabel }: { value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; ariaLabel: string }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!container.current?.contains(event.target as globalThis.Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const selected = options.find((option) => option.value === value);
  return <div className={`smooth-select ${open ? "is-open" : ""}`} ref={container}>
    <button type="button" className="smooth-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span>{selected?.label ?? value}</span><ChevronDown size={14} /></button>
    {open && <div className="smooth-select-menu" role="listbox" aria-label={ariaLabel}>{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={option.value === value ? "selected" : ""} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}{option.value === value && <Check size={13} />}</button>)}</div>}
  </div>;
}

function scriptVisualStyle(data: CanvasNodeData) {
  const selected = nodeString(data, "visualStyle", "电影写实");
  return selected === "自定义风格" ? nodeString(data, "customVisualStyle", "").trim() : selected;
}

function NodeRunStatus({ data }: { data: CanvasNodeData }) {
  const state = data.runState ?? "idle";
  if (!data.operation && state === "idle") return null;
  const message = data.statusMessage || (data.operation ? "等待上游数据" : "");
  return <p className={`infinite-run-status ${state}`}>
    {state === "running" ? <LoaderCircle className="spin" size={12} /> : state === "error" ? <CircleAlert size={12} /> : state === "success" ? <Check size={12} /> : <i />}
    <span>{message}</span>
  </p>;
}

function NodeRunner({ id, data }: { id: string; data: CanvasNodeData }) {
  const runtime = useContext(CanvasRuntimeContext);
  if (!runtime || !data.operation) return null;
  const running = data.runState === "running";
  const meta = operationMeta[data.operation];
  return <div className="infinite-node-runner nodrag nowheel">
    <NodeRunStatus data={data} />
    <button type="button" disabled={running} onClick={(event) => { event.stopPropagation(); runtime.runNode(id); }}>
      {running ? <LoaderCircle className="spin" size={13} /> : data.runState === "error" ? <Workflow size={13} /> : <Play size={13} fill="currentColor" />}
      {running ? meta.running : data.runState === "error" ? `重试：${meta.label}` : meta.label}
    </button>
  </div>;
}

function CreativeCanvasNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const metadata = kindMeta[data.kind];
  const { updateNodeData } = useReactFlow<CanvasNode, Edge>();
  const runtime = useContext(CanvasRuntimeContext);
  const uploadRef = useRef<HTMLInputElement>(null);
  const isScript = data.kind === "script";
  const noteOpen = Boolean(data.noteOpen);
  const note = nodeString(data, "note", "");
  const visualStyle = nodeString(data, "visualStyle", "电影写实");
  const statusText = typeof data.assetStatus === "string" ? data.assetStatus : data.confirmed ? "设置已确认并保存" : "";
  const update = (patch: Partial<CanvasNodeData>) => updateNodeData(id, patch);
  const handleTextUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update({ label: file.name.replace(/\.[^.]+$/, "") || data.label, description: String(reader.result ?? "") });
    reader.readAsText(file);
    event.target.value = "";
  };
  const mode = nodeString(data, "workMode", isScript ? "智能分镜" : "画面设计");
  const operationActionLabel = data.operation ? operationMeta[data.operation].label : "";

  return <article className={`infinite-node infinite-creative-node infinite-node-${data.kind} ${isScript && data.description.trim() ? "has-script-content" : ""} ${selected ? "selected" : ""}`} style={{ "--node-accent": metadata.color } as React.CSSProperties}>
    <Handle type="target" position={Position.Left} className="infinite-handle" />
    <header>
      <span><i>{isScript ? <BookOpenText size={15} /> : <Clapperboard size={15} />}</i>{isScript ? "剧本节点" : "分镜节点"}</span>
      <div className="infinite-node-head-actions">
        <small title={data.label}>{data.label}</small>
        <button type="button" className="infinite-node-delete-button nodrag" onClick={(event) => { event.stopPropagation(); runtime?.deleteNode(id); }} aria-label="删除节点" title="删除节点"><Trash2 size={13} /></button>
      </div>
    </header>
    {!isScript && <div className="infinite-creative-actions nodrag nowheel">
      <input ref={uploadRef} type="file" accept=".txt,.md,.json,text/plain,text/markdown,application/json" onChange={handleTextUpload} />
      <button type="button" onClick={() => uploadRef.current?.click()}><FileUp size={14} />上传</button>
      <button type="button" className={noteOpen ? "active" : ""} onClick={() => update({ noteOpen: !noteOpen })}><MessageSquarePlus size={14} />添加备注</button>
      <button type="button" onClick={() => update({ assetStatus: "已检查上游主体与提示词" })}><ScanSearch size={14} />检查上游</button>
    </div>}
    <div className="infinite-creative-body nodrag nowheel">
      <label className="infinite-creative-copy">
        <span>{isScript ? "剧本输入" : "镜头描述"}</span>
        <textarea value={data.description} maxLength={isScript ? 200000 : 1200} onChange={(event) => update({ description: event.target.value })} placeholder={isScript ? "输入剧情、对白和场景说明……" : "描述这个分镜中的人物、动作、环境和画面重点……"} />
        <small>{data.description.length}/{isScript ? 200000 : 1200}</small>
      </label>
      {isScript && !data.description.trim() && <div className="infinite-script-upload nodrag nowheel">
        <input ref={uploadRef} type="file" accept=".txt,.md,.json,text/plain,text/markdown,application/json" onChange={handleTextUpload} />
        <button type="button" onClick={() => uploadRef.current?.click()}><FileUp size={16} /><span><strong>上传剧本文件</strong><small>支持 TXT、Markdown 和 JSON</small></span></button>
      </div>}
      {!isScript && noteOpen && <label className="infinite-creative-note"><span>创作备注</span><input value={note} onChange={(event) => update({ note: event.target.value })} placeholder="记录修改方向或协作说明" /></label>}
      {!isScript && <div className="infinite-creative-tabs" role="tablist" aria-label="分镜设计方式">
        {["画面设计", "运动设计"].map((item) => <button type="button" role="tab" aria-selected={mode === item} className={mode === item ? "selected" : ""} key={item} onClick={() => update({ workMode: item })}>{item}</button>)}
      </div>}
      {isScript ? <>
        <label className="infinite-system-prompt nodrag nowheel">
          <span>系统提示词</span>
          <textarea value={nodeString(data, "formatSystemPrompt", "")} maxLength={12000} onChange={(event) => update({ formatSystemPrompt: event.target.value })} placeholder="留空时使用系统内置的剧本格式化提示词" />
        </label>
      </> : <>
        <CanvasChoiceRow label="景别" options={shotScales} value={nodeString(data, "shotScale", "中景")} onChange={(value) => update({ shotScale: value })} />
        <CanvasChoiceRow label="镜头运动" options={shotMoves} value={nodeString(data, "cameraMove", "推进")} onChange={(value) => update({ cameraMove: value })} />
        <div className="infinite-creative-split">
          <CanvasChoiceRow label="时长" options={shotDurations} value={nodeString(data, "duration", "5 秒")} onChange={(value) => update({ duration: value })} />
          <CanvasChoiceRow label="画幅" options={shotRatios} value={nodeString(data, "ratio", "16:9")} onChange={(value) => update({ ratio: value })} />
        </div>
      </>}
      {data.operation && !isScript ? <NodeRunStatus data={data} /> : !data.operation && statusText ? <p className="infinite-creative-status"><Check size={12} />{statusText}</p> : null}
      <button type="button" disabled={data.runState === "running"} className="infinite-creative-confirm" onClick={() => data.operation ? runtime?.runNode(id) : update({ meta: `${nodeString(data, "shotScale", "中景")} · ${nodeString(data, "cameraMove", "推进")} · ${nodeString(data, "duration", "5 秒")} · ${nodeString(data, "ratio", "16:9")}`, confirmed: true })}>{data.runState === "running" ? <LoaderCircle className="spin" size={14} /> : <WandSparkles size={14} />}{data.operation ? data.runState === "running" ? operationMeta[data.operation].running : data.runState === "error" ? `重试：${operationActionLabel}` : operationActionLabel : "确认分镜设置"}</button>
      {!isScript && <small className="infinite-creative-hint">每个节点只读取已连接的上游结果，成功后可继续运行下一节点</small>}
    </div>
    <Handle type="source" position={Position.Right} className="infinite-handle" />
  </article>;
}

function FormattedScriptCanvasNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const metadata = kindMeta.formattedScript;
  const runtime = useContext(CanvasRuntimeContext);
  const episodeRunState = data.episodeRunState as CanvasRunState | undefined;
  const episodeRunning = episodeRunState === "running";

  return <article className={`infinite-node infinite-formatted-script-node infinite-node-generated ${selected ? "selected" : ""}`} style={{ "--node-accent": metadata.color } as React.CSSProperties}>
    <Handle type="target" position={Position.Left} className="infinite-handle" />
    <header>
      <span><i><BookOpenText size={14} /></i>格式化剧本</span>
      <div className="infinite-node-head-actions">
        <small>已完成</small>
        <button type="button" className="infinite-node-delete-button nodrag" onClick={(event) => { event.stopPropagation(); runtime?.deleteNode(id); }} aria-label="删除节点" title="删除节点"><Trash2 size={13} /></button>
      </div>
    </header>
    <div className="infinite-formatted-script-copy nodrag nowheel">
      <div><strong>{data.label}</strong>{data.meta && <small>{data.meta}</small>}</div>
      <p>{data.description || "暂无格式化内容"}</p>
    </div>
    <div className="infinite-formatted-script-action nodrag nowheel">
      <button type="button" disabled={episodeRunning} onClick={() => runtime?.runFormattedEpisodes(id)}>
        {episodeRunning ? <LoaderCircle className="spin" size={15} /> : <ListTree size={15} />}
        {episodeRunning ? "正在分集" : episodeRunState === "error" ? "重试剧本分集" : "剧本分集"}
      </button>
    </div>
    <Handle type="source" position={Position.Right} className="infinite-handle" />
  </article>;
}

function EpisodeCanvasNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const metadata = kindMeta.episodes;
  const runtime = useContext(CanvasRuntimeContext);
  const subjectRunState = data.subjectRunState as CanvasRunState | undefined;
  const shotRunState = data.shotRunState as CanvasRunState | undefined;
  const subjectRunning = subjectRunState === "running";
  const shotRunning = shotRunState === "running";
  const busy = subjectRunning || shotRunning;

  return <article className={`infinite-node infinite-node-episodes infinite-node-generated ${selected ? "selected" : ""}`} style={{ "--node-accent": metadata.color } as React.CSSProperties}>
    <Handle type="target" position={Position.Left} className="infinite-handle" />
    <header>
      <span><i><ListTree size={14} /></i>分集</span>
      <div className="infinite-node-head-actions">
        <small>已完成</small>
        <button type="button" className="infinite-node-delete-button nodrag" onClick={(event) => { event.stopPropagation(); runtime?.deleteNode(id); }} aria-label="删除节点" title="删除节点"><Trash2 size={13} /></button>
      </div>
    </header>
    <div className="infinite-node-copy">
      <strong>{data.label}</strong>
      <p>{data.description || "本集暂无正文内容"}</p>
    </div>
    <div className="infinite-episode-actions nodrag nowheel">
      <button type="button" disabled={busy} onClick={() => runtime?.runEpisodeSubjects(id)}>
        {subjectRunning ? <LoaderCircle className="spin" size={14} /> : <Users size={14} />}
        {subjectRunning ? "正在提取主体" : subjectRunState === "error" ? "重试主体" : subjectRunState === "success" ? `重新提取主体${data.subjectCount ? ` (${data.subjectCount})` : ""}` : "提取本集主体"}
      </button>
      <button type="button" disabled={busy} onClick={() => runtime?.runEpisodeShots(id)}>
        {shotRunning ? <LoaderCircle className="spin" size={14} /> : <Clapperboard size={14} />}
        {shotRunning ? "正在生成分镜" : shotRunState === "error" ? "重试分镜" : shotRunState === "success" ? `重新生成分镜${data.shotCount ? ` (${data.shotCount})` : ""}` : "生成本集分镜"}
      </button>
    </div>
    <Handle type="source" position={Position.Right} className="infinite-handle" />
  </article>;
}

function SubjectCanvasNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const runtime = useContext(CanvasRuntimeContext);
  const { updateNodeData } = useReactFlow<CanvasNode, Edge>();
  const metadata = kindMeta[data.kind];
  const Icon = metadata.icon;
  const imageUrl = data.thumbnailUrl || data.mediaUrl;
  const imageRunState = data.imageRunState as CanvasRunState | undefined;
  const running = imageRunState === "running";
  const savedStyle = nodeString(data, "imageStyle", subjectStyleOptions[0]);
  const style = subjectStyleOptions.includes(savedStyle) ? savedStyle : subjectStyleOptions[0];
  const subjectPrompt = stripCanvasSubjectStyle(data.description, savedStyle);
  const model = nodeString(data, "imageModel", runtime?.imageModel ?? defaultSubjectImageModels[0]);
  const update = (patch: Partial<CanvasNodeData>) => updateNodeData(id, patch);
  const modelOptions = runtime?.imageModelOptions ?? defaultSubjectImageModels;

  return <article className={`infinite-node infinite-subject-node infinite-node-${data.kind} infinite-node-generated ${selected ? "selected" : ""}`} style={{ "--node-accent": metadata.color } as React.CSSProperties}>
    <Handle type="target" position={Position.Left} className="infinite-handle" />
    <header>
      <span><i><Icon size={14} /></i>{metadata.label}主体</span>
      <div className="infinite-node-head-actions">
        <small>{imageUrl ? "已生成" : "待生图"}</small>
        <button type="button" className="infinite-node-delete-button nodrag" onClick={(event) => { event.stopPropagation(); runtime?.deleteNode(id); }} aria-label="删除节点" title="删除节点"><Trash2 size={13} /></button>
      </div>
    </header>
    <div className={`infinite-subject-preview ${imageUrl ? "has-image" : ""}`}>
      {imageUrl ? <img src={imageUrl} alt={`${data.label}主体图`} loading="lazy" /> : <><Icon size={27} /><span>等待生成主体图</span></>}
    </div>
    <div className="infinite-node-copy infinite-subject-copy">
      <strong>{data.label}</strong>
      <p>{subjectPrompt || "未填写主体提示词"}</p>
    </div>
    <div className="infinite-subject-controls nodrag nowheel">
      <label className="infinite-subject-field"><span>风格类型</span><CanvasSelect value={style} ariaLabel={`${data.label}风格类型`} options={subjectStyleOptions.map((option) => ({ value: option, label: option }))} onChange={(value) => update({ imageStyle: value })} /></label>
      {style === "自定义风格" && <label className="infinite-subject-custom"><span>自定义风格</span><input value={nodeString(data, "customImageStyle", "")} maxLength={200} onChange={(event) => update({ customImageStyle: event.target.value })} placeholder="输入材质、色彩与画面风格" /></label>}
      <label className="infinite-subject-field"><span>生图模型</span><CanvasSelect value={model} ariaLabel={`${data.label}生图模型`} options={modelOptions.map((option) => ({ value: option, label: option.replace("doubao-seedream-", "Seedream ") }))} onChange={(value) => update({ imageModel: value })} /></label>
      {imageRunState === "error" && <p className="infinite-subject-status error"><CircleAlert size={12} />{nodeString(data, "imageStatusMessage", "图片生成失败")}</p>}
      {imageRunState === "success" && <p className="infinite-subject-status success"><Check size={12} />已生成并加入资产库</p>}
      <button type="button" className="infinite-subject-generate" disabled={running} onClick={() => runtime?.generateSubjectImage(id)}>
        {running ? <LoaderCircle className="spin" size={15} /> : <ImageIcon size={15} />}
        {running ? "正在生成图片" : imageUrl ? "重新生成图片" : "生成主体图片"}
      </button>
    </div>
    <Handle type="source" position={Position.Right} className="infinite-handle" />
  </article>;
}

function ShotCanvasNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const runtime = useContext(CanvasRuntimeContext);
  const { updateNodeData } = useReactFlow<CanvasNode, Edge>();
  const metadata = kindMeta.shotItem;
  const videoRunState = data.videoRunState as CanvasRunState | undefined;
  const running = videoRunState === "running";
  const duration = Math.min(12, Math.max(2, numericChoice(data.recommendedDuration, 6)));
  const location = nodeString(data, "location", "未设场景");
  const camera = nodeString(data, "camera", "默认机位");
  const savedModel = nodeString(data, "videoModel", runtime?.videoModel ?? defaultVideoModels[0]) as VideoSettings["model"];
  const videoModel = defaultVideoModels.includes(savedModel) ? savedModel : runtime?.videoModel ?? defaultVideoModels[0];
  const videoModelOptions = runtime?.videoModelOptions ?? defaultVideoModels;
  const subjectReferences = (Array.isArray(data.subjectReferences) ? data.subjectReferences : []).filter((item): item is ShotSubjectReference => Boolean(item && typeof item === "object" && typeof (item as ShotSubjectReference).id === "string" && typeof (item as ShotSubjectReference).name === "string"));

  return <article className={`infinite-node infinite-shot-card infinite-node-shotItem infinite-node-generated ${selected ? "selected" : ""}`} style={{ "--node-accent": metadata.color } as React.CSSProperties}>
    <Handle type="target" position={Position.Left} className="infinite-handle" />
    <header>
      <span><i><Film size={14} /></i>镜头</span>
      <div className="infinite-node-head-actions">
        <small className="infinite-shot-duration">推荐 {duration} 秒</small>
        <button type="button" className="infinite-node-delete-button nodrag" onClick={(event) => { event.stopPropagation(); runtime?.deleteNode(id); }} aria-label="删除节点" title="删除节点"><Trash2 size={13} /></button>
      </div>
    </header>
    <div className="infinite-shot-references nodrag nowheel">
      <span>主体参考</span>
      {subjectReferences.length ? <div>{subjectReferences.map((subject) => {
        const SubjectIcon = subject.kind === "scene" ? MapPin : subject.kind === "prop" ? Package : UserRound;
        return <figure key={subject.id} title={subject.name}>
          <i>{subject.imageUrl ? <img src={subject.imageUrl} alt={subject.name} loading="lazy" /> : <SubjectIcon size={17} />}</i>
          <figcaption>{subject.name}</figcaption>
        </figure>;
      })}</div> : <small>未匹配到本集主体</small>}
    </div>
    <div className="infinite-node-copy infinite-shot-copy">
      <strong>{data.label}</strong>
      <p>{data.description || "暂无镜头提示词"}</p>
      <div className="infinite-shot-facts">
        <span><MapPin size={11} />{location}</span>
        <span><Clapperboard size={11} />{camera}</span>
      </div>
    </div>
    <div className="infinite-shot-actions nodrag nowheel">
      <label className="infinite-shot-model-field"><span>视频模型</span><CanvasSelect value={videoModel} ariaLabel={`${data.label}视频模型`} options={videoModelOptions.map((model) => ({ value: model, label: videoModelLabels[model] }))} onChange={(model) => updateNodeData(id, { videoModel: model })} /></label>
      {videoRunState === "error" && <p className="infinite-shot-status error"><CircleAlert size={12} />{nodeString(data, "videoStatusMessage", "视频生成失败")}</p>}
      {videoRunState === "success" && <p className="infinite-shot-status success"><Check size={12} />视频已生成并加入资产库</p>}
      <button type="button" disabled={running} onClick={() => runtime?.generateShotVideo(id)}>
        {running ? <LoaderCircle className="spin" size={15} /> : <Video size={15} />}
        {running ? nodeString(data, "videoStatusMessage", "正在生成视频") : videoRunState === "error" ? "重试生成视频" : videoRunState === "success" ? "重新生成视频" : "生成视频"}
      </button>
    </div>
    <Handle type="source" position={Position.Right} className="infinite-handle" />
  </article>;
}

function CanvasCardNode(props: NodeProps<CanvasNode>) {
  const runtime = useContext(CanvasRuntimeContext);
  if (props.data.kind === "script" || props.data.kind === "shot") return <CreativeCanvasNode {...props} />;
  if (props.data.kind === "formattedScript") return <FormattedScriptCanvasNode {...props} />;
  if (props.data.kind === "episodes" && props.data.source === "generated") return <EpisodeCanvasNode {...props} />;
  if ((props.data.kind === "character" || props.data.kind === "scene" || props.data.kind === "prop") && props.data.source === "generated" && props.data.entityId && props.data.projectId) return <SubjectCanvasNode {...props} />;
  if (props.data.kind === "shotItem" && props.data.source === "generated" && props.data.entityId && props.data.projectId) return <ShotCanvasNode {...props} />;
  const { data, selected } = props;
  const metadata = kindMeta[data.kind];
  const Icon = data.mediaType === "audio" ? AudioLines : data.mediaType === "image" ? ImageIcon : metadata.icon;
  const imageUrl = data.thumbnailUrl || (data.kind === "image" || data.mediaType === "image" ? data.mediaUrl : null);
  const isVideo = data.kind === "video" || data.kind === "merge" || data.mediaType === "video";
  const showMediaPlaceholder = (data.kind === "image" || isVideo) && !imageUrl && !data.mediaUrl && !data.operation;
  return <article className={`infinite-node infinite-node-${data.kind} ${data.source === "generated" ? "infinite-node-generated" : ""} ${data.contentMode === "full" ? "infinite-node-full-content" : ""} ${selected ? "selected" : ""}`} style={{ "--node-accent": metadata.color } as React.CSSProperties}>
    <Handle type="target" position={Position.Left} className="infinite-handle" />
    <header>
      <span><i><Icon size={14} /></i>{metadata.label}</span>
      <div className="infinite-node-head-actions">
        <small className={data.runState ? `run-${data.runState}` : ""}>{data.runState === "running" ? "运行中" : data.runState === "success" ? "已完成" : data.runState === "error" ? "需重试" : data.source === "asset" ? "素材" : data.source === "generated" ? "结果" : data.source === "template" ? "示例" : "节点"}</small>
        <button type="button" className="infinite-node-delete-button nodrag" onClick={(event) => { event.stopPropagation(); runtime?.deleteNode(props.id); }} aria-label="删除节点" title="删除节点"><Trash2 size={13} /></button>
      </div>
    </header>
    {isVideo && data.mediaUrl ? <div className="infinite-node-media infinite-node-video-preview">
      <video className="nodrag" src={data.mediaUrl} poster={data.thumbnailUrl ?? undefined} muted loop playsInline preload="metadata" onMouseEnter={(event) => void event.currentTarget.play()} onMouseLeave={(event) => { event.currentTarget.pause(); event.currentTarget.currentTime = 0; }} />
      <span><Play size={16} fill="currentColor" /></span>
    </div> : imageUrl ? <div className="infinite-node-media"><img src={imageUrl} alt={data.label} loading="lazy" /></div> : showMediaPlaceholder ? <div className="infinite-node-media infinite-node-media-empty"><Icon size={30} /><span>在右侧添加{metadata.label}地址</span></div> : null}
    {data.kind === "audio" && <div className="infinite-node-audio">
      <span><AudioLines size={22} /></span>
      {data.mediaUrl ? <audio className="nodrag" src={data.mediaUrl} controls preload="metadata" /> : <small>在右侧添加音频地址</small>}
    </div>}
    <div className="infinite-node-copy">
      <strong>{data.label}</strong>
      <p>{data.description || "未填写描述"}</p>
      {data.meta && <small><span />{data.meta}</small>}
    </div>
    <NodeRunner id={props.id} data={data} />
    <Handle type="source" position={Position.Right} className="infinite-handle" />
  </article>;
}

const nodeTypes = { canvasCard: CanvasCardNode };

function assetToNodeKind(asset: AssetLibraryItem): CanvasNodeKind {
  if (asset.mediaType === "video" || asset.mediaType === "audio") return asset.mediaType;
  if (asset.kind === "character" || asset.kind === "scene" || asset.kind === "prop") return asset.kind;
  return "image";
}

function hasAssetPreview(asset: AssetLibraryItem) {
  const mediaUrl = asset.mediaUrl.trim();
  const thumbnailUrl = asset.thumbnailUrl?.trim() ?? "";
  if (asset.mediaType === "audio") return Boolean(mediaUrl);
  if (asset.mediaType === "video") return Boolean(mediaUrl && thumbnailUrl);
  return Boolean(thumbnailUrl || mediaUrl);
}

function createNodeId() {
  return `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneCanvas(canvas: SavedCanvas): SavedCanvas {
  return JSON.parse(JSON.stringify(canvas)) as SavedCanvas;
}

function numericChoice(value: unknown, fallback: number) {
  const parsed = Number.parseInt(typeof value === "string" ? value : "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function canvasError(error: unknown) {
  return error instanceof Error ? error.message : "节点执行失败";
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function subjectImagePrompt(subject: Subject, style: string) {
  const role = subject.role === "character" ? "角色" : subject.role === "location" ? "场景" : "道具";
  const requirement = subject.role === "location"
    ? "画布水平分为上、中、下三个等高区域，依次展示同一空场景的清晨、日间、夜晚；三个区域的空间结构、视点、比例、门窗、出入口、固定家具设备和物件位置完全一致，只改变对应时间段的自然光线；不要出现人物、动物、剧情动作、文字和水印。"
    : subject.role === "prop"
      ? "生成完整单体物品四视图，同一画布从左到右依次展示正面、左侧、背面、右侧；四个视图等高等比例，外形、材质、颜色和结构完全一致；不要出现人物、手、场景、其他道具、文字和水印。"
      : "生成同一人物四视图，同一画布从左到右依次展示正面、左侧、背面、右侧；四个视图等高等比例、全身完整，脸型、发型、体态、服装、配饰和识别特征完全一致；禁止额外人物、动作场景、文字和水印。";
  const description = stripCanvasSubjectStyle(subject.description, style) || "未设定";
  const visualPrompt = stripCanvasSubjectStyle(subject.visualPrompt, style) || "未设定";
  return [`视觉风格：${style}`, `${role}名称：${subject.name}`, `${role}描述：${description}`, `主体提示词：${visualPrompt}`, `生成要求：${requirement}`].join("\n");
}

function episodeNodeItems(episodes: Episode[], projectId: string) {
  return episodes.map((episode) => {
    const content = episode.originalText.trim() || [episode.summary, episode.hook].filter(Boolean).join("\n\n");
    return {
      entityId: episode.id,
      kind: "episodes" as const,
      label: `第${episode.episodeNumber}集 · ${episode.title}`,
      description: content || "本集暂无正文内容",
      meta: `${episode.sceneCount} 个场景 · ${content.length} 字`,
      projectId,
    };
  });
}

function shotReferencesFromNodes(subjectNodes: CanvasNode[], shot: Pick<Shot, "location" | "action" | "dialogue" | "visualPrompt">): ShotSubjectReference[] {
  const content = `${shot.location}\n${shot.action}\n${shot.dialogue}\n${shot.visualPrompt}`;
  const references = subjectNodes.filter((node) => node.data.label.trim() && content.includes(node.data.label.trim()));
  if (!references.some((node) => node.data.kind === "scene")) {
    const scenes = subjectNodes.filter((node) => node.data.kind === "scene");
    if (scenes.length === 1) references.unshift(scenes[0]);
  }
  return Array.from(new Map(references.map((node) => [node.data.entityId, node])).values())
    .filter((node) => typeof node.data.entityId === "string")
    .map((node) => ({
      id: node.data.entityId as string,
      name: node.data.label,
      imageUrl: typeof (node.data.thumbnailUrl || node.data.mediaUrl) === "string" ? (node.data.thumbnailUrl || node.data.mediaUrl) as string : null,
      kind: (node.data.kind === "scene" ? "scene" : node.data.kind === "prop" ? "prop" : "character") as ShotSubjectReference["kind"],
    }))
    .slice(0, 12);
}

function findProjectId(nodeId: string, nodes: CanvasNode[], edges: Edge[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    const projectId = byId.get(currentId)?.data.projectId;
    if (typeof projectId === "string" && projectId) return projectId;
    for (const edge of edges) if (edge.target === currentId) queue.push(edge.source);
  }
  return null;
}

function findUpstreamNode(nodeId: string, nodes: CanvasNode[], edges: Edge[], predicate: (node: CanvasNode) => boolean) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const queue = edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source);
  while (queue.length) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    const current = byId.get(currentId);
    if (!current) continue;
    if (predicate(current)) return current;
    for (const edge of edges) if (edge.target === currentId) queue.push(edge.source);
  }
  return null;
}

export default function InfiniteCanvasStudio({ onToast, onBack }: { onToast: (message: string) => void; onBack: () => void }) {
  const saved = useMemo(readSavedCanvas, []);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(saved.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(saved.edges);
  const [flow, setFlow] = useState<ReactFlowInstance<CanvasNode, Edge> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetLibraryItem[]>([]);
  const [assetLoading, setAssetLoading] = useState(true);
  const [imageSettings, setImageSettings] = useState<ImageSettings | null>(null);
  const [videoSettings, setVideoSettings] = useState<VideoSettings | null>(null);
  const [assetQuery, setAssetQuery] = useState("");
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [shotPromptDialog, setShotPromptDialog] = useState<{ episodeNodeId: string; episodeLabel: string; systemPrompt: string; style: string } | null>(null);
  const [saveState, setSaveState] = useState<"saving" | "saved">("saved");
  const [zoom, setZoom] = useState(.75);
  const [historyPosition, setHistoryPosition] = useState({ index: 0, length: 1 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<SavedCanvas[]>([cloneCanvas(saved)]);
  const historyIndexRef = useRef(0);
  const applyingHistoryRef = useRef(false);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  useEffect(() => {
    let active = true;
    void api.assets().then((result) => { if (active) setAssets(result.items); }).catch(() => { if (active) setAssets([]); }).finally(() => { if (active) setAssetLoading(false); });
    void api.imageSettings().then((settings) => { if (active) setImageSettings(settings); }).catch(() => undefined);
    void api.videoSettings().then((settings) => { if (active) setVideoSettings(settings); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges }));
      setSaveState("saved");
    }, 280);
    return () => window.clearTimeout(timer);
  }, [nodes, edges]);

  useEffect(() => {
    if (applyingHistoryRef.current) {
      applyingHistoryRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      const next = cloneCanvas({ nodes, edges });
      const current = historyRef.current[historyIndexRef.current];
      if (JSON.stringify(current) === JSON.stringify(next)) return;
      const updated = [...historyRef.current.slice(0, historyIndexRef.current + 1), next].slice(-40);
      historyRef.current = updated;
      historyIndexRef.current = updated.length - 1;
      setHistoryPosition({ index: historyIndexRef.current, length: updated.length });
    }, 420);
    return () => window.clearTimeout(timer);
  }, [nodes, edges]);

  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;
  const imageModel = imageSettings?.model || defaultSubjectImageModels[0];
  const imageModelOptions = useMemo(() => Array.from(new Set([imageModel, ...defaultSubjectImageModels].filter(Boolean))), [imageModel]);
  const visibleAssets = assets.filter(hasAssetPreview);
  const filteredAssets = visibleAssets.filter((item) => {
    const query = assetQuery.trim().toLocaleLowerCase();
    return !query || [item.title, item.description, item.projectTitle ?? "", item.detail].some((value) => value.toLocaleLowerCase().includes(query));
  }).slice(0, 18);

  const hideBrokenAsset = (asset: AssetLibraryItem) => {
    setAssets((current) => current.filter((item) => item.id !== asset.id || item.source !== asset.source));
  };

  const patchCanvasNode = useCallback((nodeId: string, patch: Partial<CanvasNodeData>) => {
    setNodes((current) => {
      const next = current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node);
      nodesRef.current = next;
      return next;
    });
  }, [setNodes]);

  const invalidateDescendants = useCallback((nodeId: string) => {
    const descendants = new Set<string>();
    const queue = [nodeId];
    while (queue.length) {
      const source = queue.shift()!;
      for (const edge of edgesRef.current) {
        if (edge.source !== source || descendants.has(edge.target)) continue;
        descendants.add(edge.target);
        queue.push(edge.target);
      }
    }
    if (!descendants.size) return;
    setNodes((current) => {
      const next = current.map((node) => descendants.has(node.id) && node.data.operation ? { ...node, data: { ...node.data, runState: "idle" as const, statusMessage: "上游已更新，请重新运行" } } : node);
      nodesRef.current = next;
      return next;
    });
  }, [setNodes]);

  const refreshAssets = useCallback(async () => {
    const result = await api.assets();
    setAssets(result.items);
  }, []);

  const generateSubjectImage = useCallback(async (nodeId: string) => {
    const node = nodesRef.current.find((item) => item.id === nodeId);
    const projectId = node && typeof node.data.projectId === "string" ? node.data.projectId : "";
    const subjectId = node && typeof node.data.entityId === "string" ? node.data.entityId : "";
    if (!node || !projectId || !subjectId) {
      onToast("当前主体缺少项目数据，请重新提取本集主体");
      return;
    }
    const savedStyle = nodeString(node.data, "imageStyle", subjectStyleOptions[0]);
    const selectedStyle = subjectStyleOptions.includes(savedStyle) ? savedStyle : subjectStyleOptions[0];
    const customStyle = nodeString(node.data, "customImageStyle", "").trim();
    if (selectedStyle === "自定义风格" && !customStyle) {
      patchCanvasNode(nodeId, { imageRunState: "error", imageStatusMessage: "请先填写自定义风格" });
      onToast("请先填写自定义风格");
      return;
    }
    patchCanvasNode(nodeId, { imageRunState: "running", imageStatusMessage: "正在生成主体图片" });
    try {
      const [pipeline, settings] = await Promise.all([api.pipeline(projectId), api.imageSettings()]);
      if (!settings.configured) throw new Error("图片模型尚未配置，请先在模型设置中配置图片服务");
      const subject = pipeline.subjects.find((item) => item.id === subjectId);
      if (!subject) throw new Error("主体数据已变化，请重新提取本集主体");
      const style = selectedStyle === "自定义风格" ? customStyle : selectedStyle;
      const model = nodeString(node.data, "imageModel", settings.model || defaultSubjectImageModels[0]);
      const result = await api.generateSubjectImage(projectId, subjectId, {
        prompt: subjectImagePrompt(subject, style),
        model,
        resolution: "2K",
        aspectRatio: "16:9",
        watermark: false,
      });
      setNodes((current) => {
        const next = current.map((item) => {
          let data = item.data.entityId === subjectId && item.data.projectId === projectId ? {
            ...item.data,
            mediaUrl: result.subject.imageUrl,
            thumbnailUrl: result.subject.imageUrl,
            mediaType: "image" as const,
            imageStyle: selectedStyle,
            customImageStyle: customStyle,
            imageModel: model,
            imageRunState: "success" as const,
            imageStatusMessage: "已生成并加入资产库",
          } : item.data;
          if (Array.isArray(data.subjectReferences) && data.subjectReferences.some((reference) => reference && typeof reference === "object" && (reference as ShotSubjectReference).id === subjectId)) {
            data = { ...data, subjectReferences: data.subjectReferences.map((reference) => reference && typeof reference === "object" && (reference as ShotSubjectReference).id === subjectId ? { ...(reference as ShotSubjectReference), imageUrl: result.subject.imageUrl } : reference) };
          }
          return data === item.data ? item : { ...item, data };
        });
        nodesRef.current = next;
        return next;
      });
      await refreshAssets();
      onToast(`${subject.name}主体图片已生成，并已加入资产库`);
    } catch (error) {
      const message = canvasError(error);
      patchCanvasNode(nodeId, { imageRunState: "error", imageStatusMessage: message });
      onToast(`主体图片生成失败：${message}`);
    }
  }, [onToast, patchCanvasNode, refreshAssets, setNodes]);

  const syncGeneratedNodes = useCallback((parentId: string, items: Array<Partial<CanvasNodeData> & { entityId: string; kind: CanvasNodeKind; label: string; description: string; projectId: string }>, generatedGroup = "default") => {
    const parent = nodesRef.current.find((node) => node.id === parentId);
    if (!parent) return;
    const snapshot = nodesRef.current;
    const existingNodes = snapshot.filter((node) => node.data.generatedBy === parentId && nodeString(node.data, "generatedGroup", "default") === generatedGroup);
    const existing = new Map(existingNodes.map((node) => [node.data.entityId, node]));
    const baseOffset = parent.data.kind === "shot" ? 600 : 210;
    const isEpisodeFanOut = parent.data.kind === "formattedScript" && items.every((item) => item.kind === "episodes");
    const episodeRows = items.length > 8 ? 4 : 3;
    const branchRows = generatedGroup === "episode-subjects" ? 2 : 3;
    const episodeSubjectCount = snapshot.filter((node) => node.data.generatedBy === parentId && nodeString(node.data, "generatedGroup", "default") === "episode-subjects").length;
    const episodeBranchStartX = generatedGroup === "episode-shots"
      ? parent.position.x + 380 + Math.max(1, Math.ceil(episodeSubjectCount / branchRows)) * 318
      : parent.position.x + 380;
    const generated: CanvasNode[] = items.map((item, index) => {
      const previous = existing.get(item.entityId);
      const generatedPosition = generatedGroup === "shot-video"
        ? { x: parent.position.x + 340, y: parent.position.y }
        : isEpisodeFanOut
        ? { x: parent.position.x + 640 + Math.floor(index / episodeRows) * 380, y: parent.position.y + (index % episodeRows) * 328 }
        : generatedGroup === "episode-subjects" || generatedGroup === "episode-shots"
          ? { x: episodeBranchStartX + Math.floor(index / branchRows) * 318, y: parent.position.y + (index % branchRows) * (generatedGroup === "episode-subjects" ? 430 : 450) }
        : { x: parent.position.x + (index % 3) * 278, y: parent.position.y + baseOffset + Math.floor(index / 3) * 188 };
      return {
        id: previous?.id ?? `${parentId}-result-${item.entityId}`,
        type: "canvasCard",
        position: previous?.position ?? generatedPosition,
        data: { ...previous?.data, ...item, source: "generated", generatedBy: parentId, generatedGroup, runState: "success", statusMessage: "由上游节点生成" },
      };
    });
    const nextNodes = [...snapshot.filter((node) => !(node.data.generatedBy === parentId && nodeString(node.data, "generatedGroup", "default") === generatedGroup)), ...generated];
    const oldGeneratedIds = new Set(existingNodes.map((node) => node.id));
    const retainedEdges = edgesRef.current.filter((edge) => !(edge.source === parentId && oldGeneratedIds.has(edge.target)));
    const nextEdges: Edge[] = [...retainedEdges, ...generated.map((target) => ({ id: `${parentId}-${target.id}`, source: parentId, target: target.id, type: "default", markerEnd: { type: MarkerType.ArrowClosed } }))];
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
  }, [setEdges, setNodes]);

  const addCanvasNode = useCallback((kind: CanvasNodeKind, input: Partial<CanvasNodeData> = {}, position?: { x: number; y: number }) => {
    const metadata = kindMeta[kind];
    const rect = canvasRef.current?.getBoundingClientRect();
    const nextPosition = position ?? (flow && rect ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 380, y: 220 });
    const next: CanvasNode = {
      id: createNodeId(),
      type: "canvasCard",
      position: { x: nextPosition.x - 110, y: nextPosition.y - 70 },
      data: { kind, label: `新建${metadata.label}`, description: "", source: "manual", ...(defaultOperationByKind[kind] ? { operation: defaultOperationByKind[kind], runState: "idle" as const, statusMessage: "等待上游数据" } : {}), ...(["image", "video", "audio"].includes(kind) ? { mediaType: kind as AssetLibraryItem["mediaType"] } : {}), ...input },
    };
    setNodes((current) => [...current, next]);
    setSelectedId(next.id);
  }, [flow, setNodes]);

  const addAsset = useCallback((asset: AssetLibraryItem, position?: { x: number; y: number }) => {
    addCanvasNode(assetToNodeKind(asset), {
      label: asset.title,
      description: asset.description || asset.detail,
      meta: asset.projectTitle ?? asset.detail,
      thumbnailUrl: asset.thumbnailUrl || (asset.mediaType === "image" ? asset.mediaUrl : null),
      mediaUrl: asset.mediaUrl,
      mediaType: asset.mediaType,
      source: "asset",
    }, position);
  }, [addCanvasNode]);

  const waitForRenderJobs = useCallback(async (projectId: string, shotIds: string[], submitted: RenderJob, nodeId: string) => {
    const startedAt = Date.parse(submitted.createdAt) - 1500;
    for (let attempt = 0; attempt < 360; attempt += 1) {
      const jobs = (await api.jobs())
        .filter((job) => job.projectId === projectId && job.shotId && shotIds.includes(job.shotId) && Date.parse(job.createdAt) >= startedAt)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      const latestByShot = new Map<string, RenderJob>();
      for (const job of jobs) if (job.shotId && !latestByShot.has(job.shotId)) latestByShot.set(job.shotId, job);
      const latest = shotIds.map((shotId) => latestByShot.get(shotId)).filter((job): job is RenderJob => Boolean(job));
      const completed = latest.filter((job) => job.status === "completed").length;
      const failed = latest.filter((job) => job.status === "failed");
      const averageProgress = latest.length ? Math.round(latest.reduce((sum, job) => sum + job.progress, 0) / latest.length) : 0;
      patchCanvasNode(nodeId, { statusMessage: `镜头 ${completed}/${shotIds.length} 已完成 · ${averageProgress}%` });
      if (failed.length) throw new Error(failed[0].errorMessage || `${failed.length} 个镜头生成失败`);
      if (latest.length === shotIds.length && completed === shotIds.length) return latest;
      await delay(5000);
    }
    throw new Error("视频生成等待超时，后台任务可能仍在继续，可稍后重试此节点");
  }, [patchCanvasNode]);

  const generateShotVideo = useCallback(async (nodeId: string) => {
    const node = nodesRef.current.find((item) => item.id === nodeId && item.data.kind === "shotItem");
    if (!node || node.data.videoRunState === "running") return;
    const projectId = typeof node.data.projectId === "string" ? node.data.projectId : "";
    const shotId = typeof node.data.entityId === "string" ? node.data.entityId : "";
    if (!projectId || !shotId) {
      onToast("当前镜头缺少项目数据，请重新生成本集分镜");
      return;
    }
    const duration = Math.min(12, Math.max(2, numericChoice(node.data.recommendedDuration, 6)));
    patchCanvasNode(nodeId, { videoRunState: "running", videoStatusMessage: "正在提交视频任务" });
    try {
      const referenceSubjectIds = (Array.isArray(node.data.subjectReferences) ? node.data.subjectReferences : [])
        .map((item) => item && typeof item === "object" && typeof (item as ShotSubjectReference).id === "string" ? (item as ShotSubjectReference).id : "")
        .filter(Boolean)
        .slice(0, 12);
      const savedModel = nodeString(node.data, "videoModel", videoSettings?.model ?? defaultVideoModels[0]) as VideoSettings["model"];
      const model = defaultVideoModels.includes(savedModel) ? savedModel : videoSettings?.model ?? defaultVideoModels[0];
      const submitted = await api.render(projectId, { shotId, duration, model, continuityMode: "auto", ...(referenceSubjectIds.length ? { referenceSubjectIds } : {}) });
      let completed: RenderJob | null = submitted.status === "completed" ? submitted : null;
      for (let attempt = 0; !completed && attempt < 360; attempt += 1) {
        const job = (await api.jobs()).find((item) => item.id === submitted.id);
        if (job?.status === "failed") throw new Error(job.errorMessage || "镜头视频生成失败");
        if (job?.status === "completed") {
          completed = job;
          break;
        }
        patchCanvasNode(nodeId, { videoStatusMessage: `正在生成视频 ${job?.progress ?? 0}%` });
        await delay(5000);
      }
      if (!completed) throw new Error("视频生成等待超时，后台任务可能仍在继续，可稍后重试");
      if (!completed.outputUrl) throw new Error("视频已经生成，但没有返回可用地址");
      syncGeneratedNodes(nodeId, [{
        entityId: completed.id,
        kind: "video",
        label: node.data.label,
        description: completed.generationPrompt || nodeString(node.data, "visualPrompt", node.data.description),
        meta: `${duration} 秒 · 已生成`,
        mediaUrl: completed.outputUrl,
        thumbnailUrl: null,
        mediaType: "video",
        projectId,
      }], "shot-video");
      patchCanvasNode(nodeId, { videoRunState: "success", videoStatusMessage: "视频已生成并加入资产库" });
      await refreshAssets();
      onToast(`${node.data.label}视频已生成`);
    } catch (error) {
      const message = canvasError(error);
      patchCanvasNode(nodeId, { videoRunState: "error", videoStatusMessage: message });
      onToast(`镜头视频生成失败：${message}`);
    }
  }, [onToast, patchCanvasNode, refreshAssets, syncGeneratedNodes, videoSettings?.model]);

  const runNode = useCallback(async (nodeId: string) => {
    const node = nodesRef.current.find((item) => item.id === nodeId);
    if (!node?.data.operation || node.data.runState === "running") return;
    const operation = node.data.operation;
    const upstreamOperations = edgesRef.current
      .filter((edge) => edge.target === nodeId)
      .map((edge) => nodesRef.current.find((item) => item.id === edge.source))
      .filter((item): item is CanvasNode => Boolean(item?.data.operation));
    const blockedBy = upstreamOperations.find((item) => item.data.runState !== "success");
    if (blockedBy) {
      const message = `请先完成上游节点“${blockedBy.data.label}”`;
      patchCanvasNode(nodeId, { runState: "error", statusMessage: message });
      onToast(message);
      return;
    }
    invalidateDescendants(nodeId);
    patchCanvasNode(nodeId, { runState: "running", statusMessage: operationMeta[operation].running });
    try {
      let projectId = operation === "format-script" ? (typeof node.data.projectId === "string" ? node.data.projectId : null) : findProjectId(nodeId, nodesRef.current, edgesRef.current);
      let successMessage = "节点执行完成";

      if (operation === "format-script") {
        const scriptText = node.data.description.trim();
        if (scriptText.length < 30) throw new Error("请先在剧本节点中输入至少 30 个字的剧本内容");
        const visualStyle = scriptVisualStyle(node.data) || "电影写实";
        const input = {
          title: node.data.label.trim() || "无限画布视频项目",
          logline: scriptText.slice(0, 5000),
          genre: nodeString(node.data, "genre", "都市"),
          style: visualStyle,
          aspectRatio: "16:9",
          durationSeconds: Math.min(720, Math.max(15, numericChoice(node.data.targetDuration, 60))),
          targetEpisodeCount: Math.min(100, Math.max(1, numericChoice(node.data.targetEpisodes, 1))),
        };
        const project = projectId ? await api.updateProject(projectId, input) : await api.createProject(input);
        projectId = project.id;
        const formatResult = await api.format(project.id, scriptText, nodeString(node.data, "formatSystemPrompt", ""));
        if (!formatResult.document?.formattedText) throw new Error("格式化完成，但没有返回完整剧本内容");
        patchCanvasNode(nodeId, { projectId, meta: `${input.style} · ${input.genre} · ${input.targetEpisodeCount} 集`, description: scriptText });
        const formattedNodeId = `${nodeId}-result-${formatResult.document.id}`;
        syncGeneratedNodes(nodeId, [{
          entityId: formatResult.document.id,
          kind: "formattedScript",
          label: "完整格式化剧本",
          description: formatResult.document.formattedText,
          meta: `${formatResult.document.formattedText.length} 字 · 格式化结果`,
          projectId: project.id,
          contentMode: "full",
          visualStyle,
          customVisualStyle: nodeString(node.data, "customVisualStyle", ""),
          genre: nodeString(node.data, "genre", "玄幻"),
          targetEpisodes: nodeString(node.data, "targetEpisodes", "1 集"),
          targetDuration: nodeString(node.data, "targetDuration", "60 秒"),
        }]);
        const episodeStage = nodesRef.current.find((item) => item.data.pipelineRoot === (node.data.pipelineRoot || node.id) && item.data.operation === "extract-episodes");
        if (episodeStage) {
          const nextEdges = [
            ...edgesRef.current.filter((edge) => !(edge.target === episodeStage.id && (edge.source === nodeId || edge.source === formattedNodeId))),
            { id: `pipeline-${formattedNodeId}-${episodeStage.id}`, source: formattedNodeId, target: episodeStage.id, type: "default", markerEnd: { type: MarkerType.ArrowClosed } } as Edge,
          ];
          edgesRef.current = nextEdges;
          setEdges(nextEdges);
        }
        successMessage = "剧本已格式化，并生成完整剧本卡片";
      } else {
        if (!projectId) throw new Error("没有找到上游项目，请先连接并运行剧本节点");

        if (operation === "extract-episodes") {
          const settingsNode = findUpstreamNode(nodeId, nodesRef.current, edgesRef.current, (item) => item.data.kind === "formattedScript");
          if (settingsNode) {
            const visualStyle = scriptVisualStyle(settingsNode.data);
            if (!visualStyle) throw new Error("请填写格式化剧本卡片中的自定义风格描述");
            await api.updateProject(projectId, {
              style: visualStyle,
              genre: nodeString(settingsNode.data, "genre", "玄幻"),
              durationSeconds: Math.min(720, Math.max(15, numericChoice(settingsNode.data.targetDuration, 60))),
              targetEpisodeCount: Math.min(100, Math.max(1, numericChoice(settingsNode.data.targetEpisodes, 1))),
            });
          }
          const result = await api.extractEpisodes(projectId);
          const preview = result.episodes.slice(0, 4).map((episode) => `${episode.episodeNumber}. ${episode.title}`).join("\n");
          patchCanvasNode(nodeId, { projectId, description: preview || "未提取到分集", meta: `${result.episodes.length} 集剧情` });
          syncGeneratedNodes(nodeId, episodeNodeItems(result.episodes, projectId));
          successMessage = `已拆分剧情并生成 ${result.episodes.length} 个分集节点`;
        }

        if (operation === "extract-subjects") {
          const result = await api.extractSubjects(projectId);
          const counts = result.subjects.reduce((total, subject) => ({ ...total, [subject.role]: total[subject.role] + 1 }), { character: 0, location: 0, prop: 0 });
          patchCanvasNode(nodeId, { projectId, description: result.subjects.map((subject) => subject.name).slice(0, 10).join("、"), meta: `角色 ${counts.character} · 场景 ${counts.location} · 道具 ${counts.prop}` });
          syncGeneratedNodes(nodeId, result.subjects.map((subject) => ({
            entityId: subject.id,
            kind: subject.role === "character" ? "character" : subject.role === "location" ? "scene" : "prop",
            label: subject.name,
            description: subject.visualPrompt || subject.description,
            meta: subject.role === "character" ? "角色主体" : subject.role === "location" ? "场景主体" : "道具主体",
            mediaUrl: subject.imageUrl,
            thumbnailUrl: subject.imageUrl,
            mediaType: subject.imageUrl ? "image" : undefined,
            projectId: projectId!,
          })));
          successMessage = `已提取 ${result.subjects.length} 个故事主体`;
        }

        if (operation === "generate-subject-images") {
          const [pipeline, settings] = await Promise.all([api.pipeline(projectId), api.imageSettings()]);
          if (!pipeline.subjects.length) throw new Error("项目中没有主体，请先运行主体提取节点");
          if (!settings.configured) throw new Error("图片模型尚未配置，请先在模型设置中配置图片服务");
          const generated: Subject[] = [];
          for (const [index, subject] of pipeline.subjects.entries()) {
            patchCanvasNode(nodeId, { statusMessage: `正在生成 ${index + 1}/${pipeline.subjects.length} · ${subject.name}` });
            if (subject.imageUrl) {
              generated.push(subject);
              continue;
            }
            const result = await api.generateSubjectImage(projectId, subject.id, {
              prompt: subjectImagePrompt(subject, pipeline.project.style),
              model: settings.model,
              resolution: "2K",
              aspectRatio: "16:9",
              watermark: false,
            });
            generated.push(result.subject);
          }
          const firstImage = generated.find((subject) => subject.imageUrl)?.imageUrl ?? null;
          patchCanvasNode(nodeId, { projectId, description: generated.map((subject) => subject.name).join("、"), meta: `${generated.filter((subject) => subject.imageUrl).length}/${generated.length} 张主体图`, mediaUrl: firstImage, thumbnailUrl: firstImage, mediaType: "image" });
          setNodes((current) => {
            const byId = new Map(generated.map((subject) => [subject.id, subject]));
            const next = current.map((item) => {
              const subject = typeof item.data.entityId === "string" ? byId.get(item.data.entityId) : undefined;
              let data = subject?.imageUrl ? { ...item.data, mediaUrl: subject.imageUrl, thumbnailUrl: subject.imageUrl, mediaType: "image" as const } : item.data;
              if (Array.isArray(data.subjectReferences)) {
                const updatedReferences = data.subjectReferences.map((reference) => {
                  if (!reference || typeof reference !== "object") return reference;
                  const generatedSubject = byId.get((reference as ShotSubjectReference).id);
                  return generatedSubject?.imageUrl ? { ...(reference as ShotSubjectReference), imageUrl: generatedSubject.imageUrl } : reference;
                });
                data = { ...data, subjectReferences: updatedReferences };
              }
              return data === item.data ? item : { ...item, data };
            });
            nodesRef.current = next;
            return next;
          });
          await refreshAssets();
          successMessage = `主体图片已生成 ${generated.filter((subject) => subject.imageUrl).length} 张`;
        }

        if (operation === "extract-shots") {
          const result = await api.extractShots(projectId);
          const projectSubjectNodes = nodesRef.current.filter((item) => item.data.projectId === projectId && ["character", "scene", "prop"].includes(item.data.kind) && typeof item.data.entityId === "string");
          patchCanvasNode(nodeId, { projectId, description: result.shots.slice(0, 8).map((shot) => `E${shot.episodeNumber}-${shot.shotOrder} ${shot.title}`).join("\n"), meta: `${result.shots.length} 个镜头` });
          syncGeneratedNodes(nodeId, result.shots.map((shot) => ({
            entityId: shot.id,
            kind: "shotItem",
            label: `E${shot.episodeNumber}-${shot.shotOrder} ${shot.title}`,
            description: [shot.action, shot.dialogue, shot.visualPrompt].filter(Boolean).join("\n\n"),
            meta: `${shot.location || "未设场景"} · ${shot.camera || "默认机位"} · ${shot.durationSeconds} 秒`,
            recommendedDuration: shot.durationSeconds,
            location: shot.location,
            camera: shot.camera,
            action: shot.action,
            dialogue: shot.dialogue,
            visualPrompt: shot.visualPrompt,
            subjectReferences: shotReferencesFromNodes(projectSubjectNodes, shot),
            projectId: projectId!,
          })));
          successMessage = `已生成 ${result.shots.length} 个分镜`;
        }

        if (operation === "render-videos") {
          const pipeline = await api.pipeline(projectId);
          if (!pipeline.shots.length) throw new Error("项目中没有分镜，请先运行分镜节点");
          const submitted = await api.render(projectId, { continuityMode: "auto" });
          const jobs = await waitForRenderJobs(projectId, pipeline.shots.map((shot) => shot.id), submitted, nodeId);
          const shotById = new Map(pipeline.shots.map((shot) => [shot.id, shot]));
          const completed = jobs.filter((job) => job.status === "completed" && job.outputUrl);
          const firstVideo = completed[0]?.outputUrl ?? null;
          patchCanvasNode(nodeId, { projectId, description: `${completed.length} 个镜头视频已经生成完成`, meta: `视频 ${completed.length}/${pipeline.shots.length}`, mediaUrl: firstVideo, thumbnailUrl: null, mediaType: "video" });
          syncGeneratedNodes(nodeId, completed.map((job) => {
            const shot = job.shotId ? shotById.get(job.shotId) : undefined;
            return {
              entityId: job.id,
              kind: "video" as const,
              label: shot ? `E${shot.episodeNumber}-${shot.shotOrder} ${shot.title}` : "镜头视频",
              description: job.generationPrompt || shot?.visualPrompt || "视频生成结果",
              meta: shot ? `${shot.durationSeconds} 秒 · 已生成` : "已生成",
              mediaUrl: job.outputUrl,
              thumbnailUrl: null,
              mediaType: "video" as const,
              projectId: projectId!,
            };
          }));
          await refreshAssets();
          successMessage = `已完成 ${completed.length} 个镜头视频`;
        }

        if (operation === "merge-videos") {
          const pipeline = await api.pipeline(projectId);
          if (!pipeline.shots.length) throw new Error("项目中没有可合成的分镜");
          const jobs = (await api.jobs()).filter((job) => job.projectId === projectId && job.status === "completed" && job.shotId && job.outputUrl).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
          const latestByShot = new Map<string, RenderJob>();
          for (const job of jobs) if (job.shotId && !latestByShot.has(job.shotId)) latestByShot.set(job.shotId, job);
          const readyShots = pipeline.shots.filter((shot) => latestByShot.has(shot.id));
          if (readyShots.length !== pipeline.shots.length) throw new Error(`仍有 ${pipeline.shots.length - readyShots.length} 个镜头视频未完成`);
          if (readyShots.length === 1) {
            const job = latestByShot.get(readyShots[0].id)!;
            patchCanvasNode(nodeId, { projectId, description: "单镜头视频已作为最终成片", meta: `${readyShots[0].durationSeconds} 秒 · 单镜头成片`, mediaUrl: job.outputUrl, thumbnailUrl: null, mediaType: "video" });
          } else {
            const merge = await api.mergeVideos(projectId, readyShots.map((shot) => shot.id));
            patchCanvasNode(nodeId, { projectId, description: `已按顺序合成 ${merge.shotIds.length} 个镜头`, meta: `${merge.durationSeconds} 秒 · 最终成片`, mediaUrl: merge.outputUrl, thumbnailUrl: merge.coverUrl, mediaType: "video", entityId: merge.id });
          }
          await refreshAssets();
          successMessage = "最终成片已经合成完成";
        }
      }

      patchCanvasNode(nodeId, { projectId: projectId ?? undefined, runState: "success", statusMessage: successMessage });
      onToast(successMessage);
    } catch (error) {
      const message = canvasError(error);
      patchCanvasNode(nodeId, { runState: "error", statusMessage: message });
      onToast(`节点执行失败：${message}`);
    }
  }, [invalidateDescendants, onToast, patchCanvasNode, refreshAssets, setNodes, syncGeneratedNodes, waitForRenderJobs]);

  const runFormattedEpisodes = useCallback(async (formattedNodeId: string) => {
    const formattedNode = nodesRef.current.find((item) => item.id === formattedNodeId && item.data.kind === "formattedScript");
    if (formattedNode?.data.episodeRunState === "running") return;
    if (!formattedNode?.data.projectId) {
      onToast("格式化剧本尚未关联项目，请先重新运行上游剧本节点");
      return;
    }
    const pipelineRoot = typeof formattedNode.data.pipelineRoot === "string"
      ? formattedNode.data.pipelineRoot
      : typeof formattedNode.data.generatedBy === "string"
        ? formattedNode.data.generatedBy
        : undefined;
    patchCanvasNode(formattedNodeId, { episodeRunState: "running", episodeStatusMessage: "正在拆分剧集" });
    try {
      const result = await api.extractEpisodes(formattedNode.data.projectId);
      const legacyEpisodeStages = nodesRef.current.filter((item) => item.data.operation === "extract-episodes" && (
        edgesRef.current.some((edge) => edge.source === formattedNodeId && edge.target === item.id)
        || Boolean(pipelineRoot && item.data.pipelineRoot === pipelineRoot)
      ));
      if (legacyEpisodeStages.length) {
        const legacyStageIds = new Set(legacyEpisodeStages.map((item) => item.id));
        const legacyEpisodeIds = new Set(nodesRef.current.filter((item) => typeof item.data.generatedBy === "string" && legacyStageIds.has(item.data.generatedBy)).map((item) => item.id));
        const downstreamIds = Array.from(new Set(edgesRef.current
          .filter((edge) => legacyStageIds.has(edge.source) && !legacyEpisodeIds.has(edge.target))
          .map((edge) => edge.target)));
        const removedIds = new Set([...legacyStageIds, ...legacyEpisodeIds]);
        const cleanedNodes = nodesRef.current.filter((item) => !removedIds.has(item.id));
        const cleanedEdges = edgesRef.current.filter((edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target));
        nodesRef.current = cleanedNodes;
        edgesRef.current = cleanedEdges;
        setNodes(cleanedNodes);
        setEdges(cleanedEdges);
        syncGeneratedNodes(formattedNodeId, episodeNodeItems(result.episodes, formattedNode.data.projectId));
        if (downstreamIds.length) {
          const generatedEpisodes = nodesRef.current.filter((item) => item.data.generatedBy === formattedNodeId && item.data.kind === "episodes");
          const redirectedEdges: Edge[] = generatedEpisodes.flatMap((episode) => downstreamIds.map((targetId) => ({
            id: `episode-flow-${episode.id}-${targetId}`,
            source: episode.id,
            target: targetId,
            type: "default",
            markerEnd: { type: MarkerType.ArrowClosed },
          })));
          const nextEdges = [...edgesRef.current, ...redirectedEdges];
          edgesRef.current = nextEdges;
          setEdges(nextEdges);
        }
      } else {
        syncGeneratedNodes(formattedNodeId, episodeNodeItems(result.episodes, formattedNode.data.projectId));
      }
      patchCanvasNode(formattedNodeId, { episodeRunState: "success", episodeStatusMessage: `已生成 ${result.episodes.length} 个分集节点` });
      onToast(`已完成剧本分集，生成 ${result.episodes.length} 个分集节点`);
    } catch (error) {
      const message = canvasError(error);
      patchCanvasNode(formattedNodeId, { episodeRunState: "error", episodeStatusMessage: message });
      onToast(`剧本分集失败：${message}`);
    }
  }, [onToast, patchCanvasNode, setEdges, setNodes, syncGeneratedNodes]);

  const runEpisodeSubjects = useCallback(async (episodeNodeId: string) => {
    const episodeNode = nodesRef.current.find((item) => item.id === episodeNodeId && item.data.kind === "episodes");
    if (!episodeNode || episodeNode.data.subjectRunState === "running") return;
    const projectId = typeof episodeNode.data.projectId === "string" ? episodeNode.data.projectId : "";
    const episodeId = typeof episodeNode.data.entityId === "string" ? episodeNode.data.entityId : "";
    if (!projectId || !episodeId) {
      onToast("当前分集缺少项目数据，请重新执行剧本分集");
      return;
    }
    patchCanvasNode(episodeNodeId, { subjectRunState: "running", subjectStatusMessage: "正在提取本集主体" });
    try {
      const result = await api.extractSubjects(projectId, { episodeId });
      const subjectCounts = result.subjects.reduce((counts, subject) => {
        counts[subject.role] += 1;
        return counts;
      }, { character: 0, location: 0, prop: 0 });
      const subjectSummary = `角色 ${subjectCounts.character} · 场景 ${subjectCounts.location} · 道具 ${subjectCounts.prop}`;
      syncGeneratedNodes(episodeNodeId, result.subjects.map((subject) => ({
        entityId: subject.id,
        kind: subject.role === "character" ? "character" as const : subject.role === "location" ? "scene" as const : "prop" as const,
        label: subject.name,
        description: subject.visualPrompt || subject.description,
        meta: subject.role === "character" ? "本集角色" : subject.role === "location" ? "本集场景" : "本集道具",
        mediaUrl: subject.imageUrl,
        thumbnailUrl: subject.imageUrl,
        mediaType: subject.imageUrl ? "image" as const : undefined,
        projectId,
      })), "episode-subjects");
      patchCanvasNode(episodeNodeId, {
        subjectRunState: "success",
        subjectStatusMessage: subjectSummary,
        subjectCount: result.subjects.length,
        ...(episodeNode.data.shotRunState === "success" ? { shotRunState: "idle", shotStatusMessage: "主体已更新，建议重新生成本集分镜" } : {}),
      });
      onToast(`${episodeNode.data.label}主体提取完成：${subjectSummary}`);
    } catch (error) {
      const message = canvasError(error);
      patchCanvasNode(episodeNodeId, { subjectRunState: "error", subjectStatusMessage: message });
      onToast(`本集主体提取失败：${message}`);
    }
  }, [onToast, patchCanvasNode, syncGeneratedNodes]);

  const runEpisodeShots = useCallback(async (episodeNodeId: string, systemPrompt = "", style = builtInSubjectStyles[0]) => {
    const episodeNode = nodesRef.current.find((item) => item.id === episodeNodeId && item.data.kind === "episodes");
    if (!episodeNode || episodeNode.data.shotRunState === "running") return;
    const projectId = typeof episodeNode.data.projectId === "string" ? episodeNode.data.projectId : "";
    const episodeId = typeof episodeNode.data.entityId === "string" ? episodeNode.data.entityId : "";
    if (!projectId || !episodeId) {
      onToast("当前分集缺少项目数据，请重新执行剧本分集");
      return;
    }
    const episodeSubjectNodes = nodesRef.current
      .filter((item) => item.data.generatedBy === episodeNodeId && nodeString(item.data, "generatedGroup", "default") === "episode-subjects" && typeof item.data.entityId === "string");
    const subjectIds = episodeSubjectNodes
      .map((item) => item.data.entityId as string);
    patchCanvasNode(episodeNodeId, { shotRunState: "running", shotStatusMessage: "正在生成本集分镜" });
    try {
      const result = await api.extractShots(projectId, { episodeId, style, ...(subjectIds.length ? { subjectIds } : {}), ...(systemPrompt.trim() ? { systemPrompt: systemPrompt.trim() } : {}) });
      syncGeneratedNodes(episodeNodeId, result.shots.map((shot) => ({
        entityId: shot.id,
        kind: "shotItem" as const,
        label: `${String(shot.shotOrder).padStart(2, "0")} · ${shot.title}`,
        description: [shot.action, shot.dialogue, shot.visualPrompt].filter(Boolean).join("\n\n"),
        meta: `${shot.location || "未设场景"} · ${shot.camera || "默认机位"} · ${shot.durationSeconds} 秒`,
        recommendedDuration: shot.durationSeconds,
        location: shot.location,
        camera: shot.camera,
        action: shot.action,
        dialogue: shot.dialogue,
        visualPrompt: shot.visualPrompt,
        subjectReferences: shotReferencesFromNodes(episodeSubjectNodes, shot),
        projectId,
      })), "episode-shots");
      patchCanvasNode(episodeNodeId, {
        shotRunState: "success",
        shotStatusMessage: `已生成 ${result.shots.length} 个分镜`,
        shotCount: result.shots.length,
      });
      onToast(`${episodeNode.data.label}已生成 ${result.shots.length} 个分镜`);
    } catch (error) {
      const message = canvasError(error);
      patchCanvasNode(episodeNodeId, { shotRunState: "error", shotStatusMessage: message });
      onToast(`本集分镜生成失败：${message}`);
    }
  }, [onToast, patchCanvasNode, syncGeneratedNodes]);

  const openEpisodeShotPrompt = useCallback((episodeNodeId: string) => {
    const episodeNode = nodesRef.current.find((item) => item.id === episodeNodeId && item.data.kind === "episodes");
    if (!episodeNode || episodeNode.data.shotRunState === "running") return;
    setShotPromptDialog({
      episodeNodeId,
      episodeLabel: episodeNode.data.label,
      systemPrompt: nodeString(episodeNode.data, "shotSystemPrompt", ""),
      style: nodeString(episodeNode.data, "shotStyle", builtInSubjectStyles[0]),
    });
  }, []);

  const confirmEpisodeShots = useCallback(() => {
    if (!shotPromptDialog) return;
    const { episodeNodeId, systemPrompt, style } = shotPromptDialog;
    patchCanvasNode(episodeNodeId, { shotSystemPrompt: systemPrompt, shotStyle: style });
    setShotPromptDialog(null);
    void runEpisodeShots(episodeNodeId, systemPrompt, style);
  }, [patchCanvasNode, runEpisodeShots, shotPromptDialog]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => addEdge({ ...connection, type: "default", markerEnd: { type: MarkerType.ArrowClosed } }, current));
  }, [setEdges]);

  const beginDrag = (event: DragEvent<HTMLElement>, payload: DragPayload) => {
    event.dataTransfer.setData(dragMime, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "copy";
  };

  const beginAssetDrag = (event: DragEvent<HTMLElement>, asset: AssetLibraryItem) => {
    event.dataTransfer.setData(dragMime, JSON.stringify({ kind: assetToNodeKind(asset), asset }));
    event.dataTransfer.effectAllowed = "copy";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!flow) return;
    try {
      const payload = JSON.parse(event.dataTransfer.getData(dragMime)) as DragPayload & { asset?: AssetLibraryItem };
      const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      if (payload.asset) addAsset(payload.asset, position);
      else if (payload.kind && kindMeta[payload.kind]) addCanvasNode(payload.kind, payload, position);
    } catch {
      return;
    }
  };

  const arrangeNodes = () => {
    const directEpisodes = nodesRef.current
      .filter((node) => node.data.kind === "episodes" && nodesRef.current.some((parent) => parent.id === node.data.generatedBy && parent.data.kind === "formattedScript"))
      .sort((left, right) => {
        const leftNumber = Number(left.data.label.match(/第(\d+)集/)?.[1] ?? Number.MAX_SAFE_INTEGER);
        const rightNumber = Number(right.data.label.match(/第(\d+)集/)?.[1] ?? Number.MAX_SAFE_INTEGER);
        return leftNumber - rightNumber;
      });
    const episodeIds = new Set(directEpisodes.map((node) => node.id));
    const episodeRows = directEpisodes.length > 8 ? 4 : 3;
    const episodeColumns = Math.max(1, Math.ceil(directEpisodes.length / episodeRows));
    const episodeStartColumn = 2;
    const afterEpisodes = episodeStartColumn + episodeColumns;
    const columns: Record<CanvasNodeKind, number> = {
      note: 0, text: 0, prompt: 0, script: 0, formattedScript: 1, episodes: episodeStartColumn,
      subjects: afterEpisodes, character: afterEpisodes + 1, scene: afterEpisodes + 1, prop: afterEpisodes + 1,
      image: afterEpisodes + 2, audio: afterEpisodes + 2, media: afterEpisodes + 2,
      shot: afterEpisodes + 3, shotItem: afterEpisodes + 4, video: afterEpisodes + 5, merge: afterEpisodes + 6,
    };
    const columnX = (column: number) => column === 0 ? 70 : column === 1 ? 700 : 1340 + (column - 2) * 390;
    const columnY = new Map<number, number>();
    const episodePositions = new Map(directEpisodes.map((node, index) => [node.id, {
      x: columnX(episodeStartColumn + Math.floor(index / episodeRows)),
      y: 65 + (index % episodeRows) * 328,
    }]));
    const nextNodes = nodesRef.current.map((node) => {
      const episodePosition = episodePositions.get(node.id);
      if (episodePosition) return { ...node, position: episodePosition };
      const column = columns[node.data.kind];
      const y = columnY.get(column) ?? 65;
      const generatedSubject = (node.data.kind === "character" || node.data.kind === "scene" || node.data.kind === "prop") && node.data.source === "generated";
      const estimatedHeight = node.data.kind === "script" || node.data.kind === "formattedScript" ? 640 : node.data.kind === "shot" ? 560 : generatedSubject ? 420 : node.data.kind === "image" || node.data.kind === "video" || node.data.kind === "merge" || node.data.thumbnailUrl ? 350 : node.data.kind === "episodes" ? 288 : 200;
      columnY.set(column, y + estimatedHeight + 60);
      return { ...node, position: { x: columnX(column), y } };
    });
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
    window.setTimeout(() => void flow?.fitView({ padding: .16, duration: 420 }), 0);
    onToast(episodeIds.size ? `节点排版已重置，${episodeIds.size} 个分集已按顺序排列` : "节点排版已重置");
  };

  const updateSelected = (field: "label" | "description" | "meta" | "mediaUrl" | "thumbnailUrl", value: string) => {
    if (!selectedId) return;
    setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, [field]: value } } : node));
  };

  const removeNodes = useCallback((nodeIds: string[]) => {
    const ids = new Set(nodeIds);
    if (!ids.size) return;
    const nextNodes = nodesRef.current.filter((node) => !ids.has(node.id));
    const nextEdges = edgesRef.current.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target));
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedId((current) => current && ids.has(current) ? null : current);
    onToast(ids.size === 1 ? "节点已删除" : `已删除 ${ids.size} 个节点`);
  }, [onToast, setEdges, setNodes]);

  const deleteNode = useCallback((nodeId: string) => {
    removeNodes([nodeId]);
  }, [removeNodes]);

  const clearAllNodes = useCallback(() => {
    if (!nodesRef.current.length || !window.confirm("确定清空画布中的全部节点和连线吗？清空后仍可使用撤销恢复。")) return;
    nodesRef.current = [];
    edgesRef.current = [];
    setNodes([]);
    setEdges([]);
    setSelectedId(null);
    setAssetsOpen(false);
    onToast("画布已清空，可使用撤销恢复");
  }, [onToast, setEdges, setNodes]);

  const moveHistory = (direction: -1 | 1) => {
    const target = historyIndexRef.current + direction;
    if (target < 0 || target >= historyRef.current.length) return;
    const snapshot = cloneCanvas(historyRef.current[target]);
    applyingHistoryRef.current = true;
    historyIndexRef.current = target;
    setHistoryPosition({ index: target, length: historyRef.current.length });
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    setSelectedId(null);
  };

  const clearSelectedNode = useCallback(() => {
    setSelectedId(null);
    setNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node));
  }, [setNodes]);

  return <main className="infinite-canvas-content">
    <header className="infinite-canvas-head">
      <div className="infinite-canvas-title">
        <button type="button" onClick={onBack} aria-label="返回首页" title="返回首页"><ArrowLeft size={18} /></button>
        <span><LayoutGrid size={14} /></span>
        <strong>无限画布</strong>
        <small>{nodes.length} 个节点</small>
      </div>
      <div className="infinite-toolbar-center">
        <button type="button" disabled={historyPosition.index === 0} onClick={() => moveHistory(-1)} aria-label="撤销" title="撤销"><Undo2 size={16} /></button>
        <button type="button" disabled={historyPosition.index >= historyPosition.length - 1} onClick={() => moveHistory(1)} aria-label="重做" title="重做"><Redo2 size={16} /></button>
        <i />
        <button type="button" onClick={() => void flow?.zoomOut({ duration: 140 })} aria-label="缩小" title="缩小"><ZoomOut size={16} /></button>
        <input type="range" min="0.22" max="1.8" step="0.02" value={zoom} onChange={(event) => void flow?.zoomTo(Number(event.target.value), { duration: 100 })} aria-label="画布缩放" />
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => void flow?.zoomIn({ duration: 140 })} aria-label="放大" title="放大"><ZoomIn size={16} /></button>
        <button type="button" onClick={() => void flow?.fitView({ padding: .2, duration: 360 })} aria-label="适配画布" title="适配画布"><Focus size={16} /></button>
        <button type="button" className="infinite-layout-reset" onClick={arrangeNodes} aria-label="节点排版重置" title="节点排版重置"><LayoutGrid size={16} /><span>排版重置</span></button>
        <i />
        <button type="button" className="infinite-clear-canvas" disabled={!nodes.length} onClick={clearAllNodes} aria-label="清空全部节点" title="清空全部节点"><Trash2 size={16} /></button>
      </div>
      <div className="infinite-head-actions">
        <span className={`infinite-save-state ${saveState}`}><Check size={13} />{saveState === "saving" ? "保存中" : "已保存"}</span>
      </div>
    </header>

    <section className="infinite-workbench">
      <div ref={canvasRef} className="infinite-flow-shell" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={handleDrop}>
        <CanvasRuntimeContext.Provider value={{ runNode: (nodeId) => void runNode(nodeId), runFormattedEpisodes, runEpisodeSubjects, runEpisodeShots: openEpisodeShotPrompt, generateSubjectImage: (nodeId) => void generateSubjectImage(nodeId), generateShotVideo: (nodeId) => void generateShotVideo(nodeId), deleteNode, imageModel, imageModelOptions, videoModel: videoSettings?.model ?? defaultVideoModels[0], videoModelOptions: defaultVideoModels }}>
        <ReactFlow<CanvasNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={setFlow}
          onMove={(_, viewport) => setZoom(viewport.zoom)}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={({ nodes: selected }) => {
            const node = selected[0];
            setSelectedId(node && node.data.kind !== "script" && node.data.kind !== "shot" ? node.id : null);
          }}
          onPaneClick={clearSelectedNode}
          onNodesDelete={(deleted) => removeNodes(deleted.map((node) => node.id))}
          fitView
          fitViewOptions={{ padding: .2 }}
          minZoom={.22}
          maxZoom={1.8}
          defaultEdgeOptions={{ type: "default", markerEnd: { type: MarkerType.ArrowClosed } }}
          connectionLineStyle={{ stroke: "#ff7167", strokeWidth: 1.5 }}
          selectionOnDrag
          panOnScroll
          deleteKeyCode={["Backspace", "Delete"]}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.15} />
          <MiniMap pannable zoomable position="bottom-right" nodeColor={(node) => kindMeta[(node.data as CanvasNodeData).kind]?.color ?? "#777"} />
        </ReactFlow>
        </CanvasRuntimeContext.Provider>

        <aside className="infinite-node-dock" aria-label="节点工具">
          <div className="infinite-node-groups">{nodeGroups.map((group) => <div className="infinite-node-group" key={group.label}>
            <small>{group.label}</small>
            <div className="infinite-node-palette">{group.kinds.map((kind) => {
                const metadata = kindMeta[kind];
                const Icon = metadata.icon;
                return <button type="button" draggable key={kind} title={`添加${metadata.label}节点`} aria-label={`添加${metadata.label}节点`} onDragStart={(event) => beginDrag(event, { kind })} onClick={() => addCanvasNode(kind)}><span style={{ "--palette-color": metadata.color } as React.CSSProperties}><Icon size={15} /></span>{metadata.label}<Plus size={12} /></button>;
              })}</div>
          </div>)}</div>
        </aside>

        <button type="button" className={`infinite-assets-trigger ${assetsOpen ? "active" : ""}`} aria-label={assetsOpen ? "关闭资产库" : "打开资产库"} aria-expanded={assetsOpen} onClick={() => setAssetsOpen((current) => !current)}><FolderOpen size={16} /><span>资产库</span><small>{visibleAssets.length}</small></button>

        {assetsOpen && <aside className="infinite-asset-drawer">
          <header><div><FolderOpen size={16} /><strong>资产库</strong><small>{visibleAssets.length}</small></div><button type="button" onClick={() => setAssetsOpen(false)} aria-label="关闭资产库"><X size={16} /></button></header>
          <label className="infinite-asset-search"><Search size={14} /><input value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} placeholder="搜索角色、场景、图片或视频" aria-label="搜索画布资产" /></label>
          <div className="infinite-assets-list">
            {assetLoading ? <div className="infinite-assets-empty"><WandSparkles size={18} /><span>正在读取资产</span></div> : filteredAssets.length ? filteredAssets.map((asset) => <button type="button" draggable key={`${asset.source}-${asset.id}`} onDragStart={(event) => beginAssetDrag(event, asset)} onClick={() => addAsset(asset)}>
              <span className="infinite-asset-thumb">{asset.mediaType === "image" ? <img src={asset.thumbnailUrl || asset.mediaUrl} alt="" onError={() => hideBrokenAsset(asset)} /> : asset.mediaType === "audio" ? <AudioLines size={20} /> : <img src={asset.thumbnailUrl || ""} alt="" onError={() => hideBrokenAsset(asset)} />}</span>
              <span><strong>{asset.title}</strong><small>{asset.projectTitle ?? kindMeta[assetToNodeKind(asset)].label}</small></span>
            </button>) : <div className="infinite-assets-empty"><FolderOpen size={18} /><span>{assetQuery ? "没有匹配资产" : "暂无可用资产"}</span></div>}
          </div>
        </aside>}

        {selectedNode && <aside className="infinite-inspector">
          <div className="infinite-panel-title"><div><span style={{ background: kindMeta[selectedNode.data.kind].color }} /><strong>节点设置</strong></div><button type="button" onClick={clearSelectedNode} aria-label="关闭节点设置"><X size={16} /></button></div>
          <div className="infinite-inspector-form">
            {(selectedNode.data.thumbnailUrl || selectedNode.data.kind === "image" && selectedNode.data.mediaUrl) && <div className="infinite-inspector-preview"><img src={selectedNode.data.thumbnailUrl || selectedNode.data.mediaUrl || ""} alt="" /></div>}
            {(selectedNode.data.kind === "video" || selectedNode.data.kind === "merge") && selectedNode.data.mediaUrl && <div className="infinite-inspector-preview"><video src={selectedNode.data.mediaUrl} poster={selectedNode.data.thumbnailUrl ?? undefined} controls preload="metadata" /></div>}
            {selectedNode.data.kind === "audio" && selectedNode.data.mediaUrl && <div className="infinite-inspector-audio"><AudioLines size={18} /><audio src={selectedNode.data.mediaUrl} controls preload="metadata" /></div>}
            <label><span>名称</span><input value={selectedNode.data.label} maxLength={80} onChange={(event) => updateSelected("label", event.target.value)} /></label>
            <label><span>{selectedNode.data.kind === "text" ? "文本内容" : "描述"}</span><textarea value={selectedNode.data.description} maxLength={1200} onChange={(event) => updateSelected("description", event.target.value)} /></label>
            <label><span>备注</span><input value={selectedNode.data.meta ?? ""} maxLength={120} onChange={(event) => updateSelected("meta", event.target.value)} placeholder="镜头、比例或版本" /></label>
            {(["image", "video", "audio", "merge", "media"] as CanvasNodeKind[]).includes(selectedNode.data.kind) && <label><span>{selectedNode.data.kind === "image" ? "图片地址" : selectedNode.data.kind === "audio" ? "音频地址" : "视频地址"}</span><input value={selectedNode.data.mediaUrl ?? ""} onChange={(event) => updateSelected("mediaUrl", event.target.value)} placeholder="https://" /></label>}
            {(selectedNode.data.kind === "video" || selectedNode.data.kind === "merge") && <label><span>封面地址</span><input value={selectedNode.data.thumbnailUrl ?? ""} onChange={(event) => updateSelected("thumbnailUrl", event.target.value)} placeholder="https://" /></label>}
            <div className="infinite-node-stats"><span>输入连接<strong>{edges.filter((edge) => edge.target === selectedNode.id).length}</strong></span><span>输出连接<strong>{edges.filter((edge) => edge.source === selectedNode.id).length}</strong></span></div>
            {selectedNode.data.mediaUrl && <a href={selectedNode.data.mediaUrl} target="_blank" rel="noreferrer" className="secondary-button infinite-open-asset">打开资产</a>}
            <button type="button" className="infinite-delete-node" onClick={() => deleteNode(selectedNode.id)}><Trash2 size={15} />删除节点</button>
          </div>
        </aside>}
      </div>
    </section>
    {shotPromptDialog && <div className="settings-backdrop infinite-shot-prompt-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShotPromptDialog(null); }}>
      <section className="settings-dialog infinite-shot-prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="infinite-shot-prompt-title">
        <div className="settings-dialog-head">
          <div><span className="panel-eyebrow">STORYBOARD PROMPT</span><h2 id="infinite-shot-prompt-title">生成{shotPromptDialog.episodeLabel}分镜</h2></div>
          <button type="button" className="icon-button" onClick={() => setShotPromptDialog(null)} aria-label="关闭分镜提示词"><X size={18} /></button>
        </div>
        <label className="infinite-shot-prompt-field">
          <span>系统提示词 <small>可选</small></span>
          <textarea autoFocus value={shotPromptDialog.systemPrompt} maxLength={12000} onChange={(event) => setShotPromptDialog((current) => current ? { ...current, systemPrompt: event.target.value } : current)} placeholder="留空使用内置分镜提示词" />
          <small>{shotPromptDialog.systemPrompt.length} / 12000</small>
        </label>
        <label className="infinite-shot-style-field">
          <span>风格类型</span>
          <CanvasSelect value={shotPromptDialog.style} ariaLabel="分镜风格类型" options={builtInSubjectStyles.map((option) => ({ value: option, label: option }))} onChange={(style) => setShotPromptDialog((current) => current ? { ...current, style } : current)} />
        </label>
        <div className="settings-actions">
          <button type="button" className="secondary-button" onClick={() => setShotPromptDialog(null)}>取消</button>
          <button type="button" className="primary-button" onClick={confirmEpisodeShots}><Clapperboard size={16} />开始生成</button>
        </div>
      </section>
    </div>}
  </main>;
}
