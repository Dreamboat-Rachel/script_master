import { DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AudioLines,
  Check,
  Clapperboard,
  Focus,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  MapPin,
  MessageSquareText,
  Package,
  Plus,
  Search,
  Trash2,
  UserRound,
  Video,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { api } from "./api";
import type { AssetLibraryItem, AssetLibraryKind } from "./types";

type CanvasNodeKind = "character" | "scene" | "prop" | "prompt" | "shot" | "media";
type CanvasNodeData = {
  kind: CanvasNodeKind;
  label: string;
  description: string;
  meta?: string;
  thumbnailUrl?: string | null;
  mediaUrl?: string | null;
  mediaType?: AssetLibraryItem["mediaType"];
  source?: "template" | "asset" | "manual";
} & Record<string, unknown>;
type CanvasNode = Node<CanvasNodeData, "canvasCard">;
type SavedCanvas = { nodes: CanvasNode[]; edges: Edge[] };
type DragPayload = Partial<CanvasNodeData> & { kind: CanvasNodeKind };

const STORAGE_KEY = "script-master-infinite-canvas-v1";
const dragMime = "application/x-script-master-canvas-node";

const kindMeta: Record<CanvasNodeKind, { label: string; icon: LucideIcon; color: string }> = {
  character: { label: "角色", icon: UserRound, color: "#e76b61" },
  scene: { label: "场景", icon: MapPin, color: "#4e9f76" },
  prop: { label: "道具", icon: Package, color: "#ca8b3e" },
  prompt: { label: "提示词", icon: MessageSquareText, color: "#7a76c8" },
  shot: { label: "分镜", icon: Clapperboard, color: "#4d88c7" },
  media: { label: "媒体", icon: Video, color: "#a260a8" },
};

const defaultNodes: CanvasNode[] = [
  { id: "sample-character", type: "canvasCard", position: { x: 60, y: 70 }, data: { kind: "character", label: "林夏", description: "短发，深色风衣，冷静克制。", meta: "主角 · 形象锁定", source: "template" } },
  { id: "sample-scene", type: "canvasCard", position: { x: 60, y: 270 }, data: { kind: "scene", label: "雨夜车站", description: "废弃站台，潮湿地面反射冷白灯光。", meta: "外景 · 夜", source: "template" } },
  { id: "sample-prompt", type: "canvasCard", position: { x: 370, y: 70 }, data: { kind: "prompt", label: "镜头提示词", description: "中景跟拍，人物缓慢走向站台尽头，雨丝清晰，电影写实。", meta: "16:9 · 6 秒", source: "template" } },
  { id: "sample-shot", type: "canvasCard", position: { x: 690, y: 170 }, data: { kind: "shot", label: "镜头 01", description: "林夏进入雨夜车站，在长椅旁停下。", meta: "中景 · 缓慢推进", source: "template" } },
  { id: "sample-media", type: "canvasCard", position: { x: 1010, y: 170 }, data: { kind: "media", label: "生成结果", description: "连接分镜后可继续扩展图片或视频版本。", meta: "等待生成", source: "template" } },
];

const defaultEdges: Edge[] = [
  { id: "sample-character-shot", source: "sample-character", target: "sample-shot", type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } },
  { id: "sample-scene-shot", source: "sample-scene", target: "sample-shot", type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } },
  { id: "sample-prompt-shot", source: "sample-prompt", target: "sample-shot", type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } },
  { id: "sample-shot-media", source: "sample-shot", target: "sample-media", type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } },
];

function readSavedCanvas(): SavedCanvas {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { nodes: defaultNodes, edges: defaultEdges };
    const parsed = JSON.parse(raw) as Partial<SavedCanvas>;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return { nodes: defaultNodes, edges: defaultEdges };
    return { nodes: parsed.nodes, edges: parsed.edges };
  } catch {
    return { nodes: defaultNodes, edges: defaultEdges };
  }
}

function CanvasCardNode({ data, selected }: NodeProps<CanvasNode>) {
  const metadata = kindMeta[data.kind];
  const Icon = data.mediaType === "audio" ? AudioLines : data.mediaType === "image" ? ImageIcon : metadata.icon;
  return <article className={`infinite-node infinite-node-${data.kind} ${selected ? "selected" : ""}`} style={{ "--node-accent": metadata.color } as React.CSSProperties}>
    <Handle type="target" position={Position.Left} className="infinite-handle" />
    {data.thumbnailUrl && <div className="infinite-node-media"><img src={data.thumbnailUrl} alt="" /></div>}
    <header><span><Icon size={13} />{metadata.label}</span>{data.source === "asset" && <small>ASSET</small>}</header>
    <div className="infinite-node-copy"><strong>{data.label}</strong><p>{data.description || "未填写描述"}</p>{data.meta && <small>{data.meta}</small>}</div>
    <Handle type="source" position={Position.Right} className="infinite-handle" />
  </article>;
}

const nodeTypes = { canvasCard: CanvasCardNode };

function assetKindToNodeKind(kind: AssetLibraryKind): CanvasNodeKind {
  if (kind === "character" || kind === "scene" || kind === "prop") return kind;
  return "media";
}

function createNodeId() {
  return `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function InfiniteCanvasStudio({ onToast }: { onToast: (message: string) => void }) {
  const saved = useMemo(readSavedCanvas, []);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(saved.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(saved.edges);
  const [flow, setFlow] = useState<ReactFlowInstance<CanvasNode, Edge> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetLibraryItem[]>([]);
  const [assetLoading, setAssetLoading] = useState(true);
  const [assetQuery, setAssetQuery] = useState("");
  const [saveState, setSaveState] = useState<"saving" | "saved">("saved");
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void api.assets().then((result) => { if (active) setAssets(result.items); }).catch(() => { if (active) setAssets([]); }).finally(() => { if (active) setAssetLoading(false); });
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

  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;
  const filteredAssets = assets.filter((item) => {
    const query = assetQuery.trim().toLocaleLowerCase();
    return !query || [item.title, item.description, item.projectTitle ?? "", item.detail].some((value) => value.toLocaleLowerCase().includes(query));
  }).slice(0, 18);

  const addCanvasNode = useCallback((kind: CanvasNodeKind, input: Partial<CanvasNodeData> = {}, position?: { x: number; y: number }) => {
    const metadata = kindMeta[kind];
    const rect = canvasRef.current?.getBoundingClientRect();
    const nextPosition = position ?? (flow && rect ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 380, y: 220 });
    const next: CanvasNode = {
      id: createNodeId(),
      type: "canvasCard",
      position: { x: nextPosition.x - 110, y: nextPosition.y - 70 },
      data: { kind, label: `新建${metadata.label}`, description: "", source: "manual", ...input },
    };
    setNodes((current) => [...current, next]);
    setSelectedId(next.id);
  }, [flow, setNodes]);

  const addAsset = useCallback((asset: AssetLibraryItem, position?: { x: number; y: number }) => {
    addCanvasNode(assetKindToNodeKind(asset.kind), {
      label: asset.title,
      description: asset.description || asset.detail,
      meta: asset.projectTitle ?? asset.detail,
      thumbnailUrl: asset.thumbnailUrl || (asset.mediaType === "image" ? asset.mediaUrl : null),
      mediaUrl: asset.mediaUrl,
      mediaType: asset.mediaType,
      source: "asset",
    }, position);
  }, [addCanvasNode]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => addEdge({ ...connection, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } }, current));
  }, [setEdges]);

  const beginDrag = (event: DragEvent<HTMLElement>, payload: DragPayload) => {
    event.dataTransfer.setData(dragMime, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "copy";
  };

  const beginAssetDrag = (event: DragEvent<HTMLElement>, asset: AssetLibraryItem) => {
    event.dataTransfer.setData(dragMime, JSON.stringify({ kind: assetKindToNodeKind(asset.kind), asset }));
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
    const columns: Record<CanvasNodeKind, number> = { character: 0, scene: 0, prop: 0, prompt: 1, shot: 2, media: 3 };
    const counts = new Map<number, number>();
    setNodes((current) => current.map((node) => {
      const column = columns[node.data.kind];
      const row = counts.get(column) ?? 0;
      counts.set(column, row + 1);
      return { ...node, position: { x: 70 + column * 310, y: 65 + row * 190 } };
    }));
    window.setTimeout(() => void flow?.fitView({ padding: .16, duration: 420 }), 0);
    onToast("画布已自动整理");
  };

  const updateSelected = (field: "label" | "description" | "meta", value: string) => {
    if (!selectedId) return;
    setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, [field]: value } } : node));
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setNodes((current) => current.filter((node) => node.id !== selectedId));
    setEdges((current) => current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId));
    setSelectedId(null);
    onToast("节点已移除");
  };

  return <main className="infinite-canvas-content">
    <header className="infinite-canvas-head">
      <div><span className="panel-eyebrow">VISUAL STORY CANVAS</span><h1>无限画布</h1><p>在同一视图中组织创作资产、提示词与分镜关系。</p></div>
      <div className="infinite-head-actions">
        <span className={`infinite-save-state ${saveState}`}><Check size={13} />{saveState === "saving" ? "保存中" : "已保存"}</span>
        <button type="button" className="secondary-button" onClick={() => addCanvasNode("shot")}><Plus size={15} />添加分镜</button>
        <button type="button" className="icon-button" onClick={arrangeNodes} title="自动整理" aria-label="自动整理"><LayoutGrid size={17} /></button>
        <button type="button" className="icon-button" onClick={() => void flow?.fitView({ padding: .16, duration: 360 })} title="适配画布" aria-label="适配画布"><Focus size={17} /></button>
      </div>
    </header>

    <section className="infinite-workbench">
      <aside className="infinite-library">
        <div className="infinite-panel-title"><div><span>01</span><strong>节点</strong></div><small>{nodes.length}</small></div>
        <div className="infinite-node-palette">
          {(Object.keys(kindMeta) as CanvasNodeKind[]).filter((kind) => kind !== "media").map((kind) => {
            const metadata = kindMeta[kind];
            const Icon = metadata.icon;
            return <button type="button" draggable key={kind} onDragStart={(event) => beginDrag(event, { kind })} onClick={() => addCanvasNode(kind)}><span style={{ "--palette-color": metadata.color } as React.CSSProperties}><Icon size={15} /></span>{metadata.label}<Plus size={13} /></button>;
          })}
        </div>
        <div className="infinite-panel-title assets-title"><div><span>02</span><strong>资产</strong></div><small>{assets.length}</small></div>
        <label className="infinite-asset-search"><Search size={14} /><input value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} placeholder="搜索资产" aria-label="搜索画布资产" /></label>
        <div className="infinite-assets-list">
          {assetLoading ? <div className="infinite-assets-empty"><WandSparkles size={18} /><span>正在读取资产</span></div> : filteredAssets.length ? filteredAssets.map((asset) => <button type="button" draggable key={`${asset.source}-${asset.id}`} onDragStart={(event) => beginAssetDrag(event, asset)} onClick={() => addAsset(asset)}>
            <span className="infinite-asset-thumb">{asset.thumbnailUrl || asset.mediaType === "image" ? <img src={asset.thumbnailUrl || asset.mediaUrl} alt="" /> : asset.mediaType === "audio" ? <AudioLines size={15} /> : <Video size={15} />}</span>
            <span><strong>{asset.title}</strong><small>{asset.projectTitle ?? kindMeta[assetKindToNodeKind(asset.kind)].label}</small></span>
          </button>) : <div className="infinite-assets-empty"><FolderOpen size={18} /><span>{assetQuery ? "没有匹配资产" : "暂无可用资产"}</span></div>}
        </div>
      </aside>

      <div ref={canvasRef} className="infinite-flow-shell" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={handleDrop}>
        <ReactFlow<CanvasNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={setFlow}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={({ nodes: selected }) => setSelectedId(selected[0]?.id ?? null)}
          onNodesDelete={(deleted) => { if (deleted.some((node) => node.id === selectedId)) setSelectedId(null); }}
          fitView
          fitViewOptions={{ padding: .16 }}
          minZoom={.22}
          maxZoom={1.8}
          defaultEdgeOptions={{ type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } }}
          connectionLineStyle={{ stroke: "#ff7167", strokeWidth: 1.5 }}
          selectionOnDrag
          panOnScroll
          deleteKeyCode={["Backspace", "Delete"]}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.15} />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap pannable zoomable position="bottom-right" nodeColor={(node) => kindMeta[(node.data as CanvasNodeData).kind]?.color ?? "#777"} />
        </ReactFlow>
        {!nodes.length && <button type="button" className="infinite-empty" onClick={() => addCanvasNode("shot")}><Clapperboard size={24} /><strong>新建第一个分镜</strong></button>}
      </div>

      <aside className="infinite-inspector">
        <div className="infinite-panel-title"><div><span>03</span><strong>节点设置</strong></div>{selectedNode && <small>{kindMeta[selectedNode.data.kind].label}</small>}</div>
        {selectedNode ? <div className="infinite-inspector-form">
          {selectedNode.data.thumbnailUrl && <div className="infinite-inspector-preview"><img src={selectedNode.data.thumbnailUrl} alt="" /></div>}
          <label><span>名称</span><input value={selectedNode.data.label} maxLength={80} onChange={(event) => updateSelected("label", event.target.value)} /></label>
          <label><span>描述</span><textarea value={selectedNode.data.description} maxLength={1200} onChange={(event) => updateSelected("description", event.target.value)} /></label>
          <label><span>备注</span><input value={selectedNode.data.meta ?? ""} maxLength={120} onChange={(event) => updateSelected("meta", event.target.value)} placeholder="镜头、比例或版本" /></label>
          <div className="infinite-node-stats"><span>输入连接<strong>{edges.filter((edge) => edge.target === selectedNode.id).length}</strong></span><span>输出连接<strong>{edges.filter((edge) => edge.source === selectedNode.id).length}</strong></span></div>
          {selectedNode.data.mediaUrl && <a href={selectedNode.data.mediaUrl} target="_blank" rel="noreferrer" className="secondary-button infinite-open-asset">打开资产</a>}
          <button type="button" className="infinite-delete-node" onClick={deleteSelected}><Trash2 size={15} />移除节点</button>
        </div> : <div className="infinite-inspector-empty"><span><WandSparkles size={20} /></span><strong>未选择节点</strong><small>{nodes.length} 个节点 · {edges.length} 条连接</small></div>}
      </aside>
    </section>
  </main>;
}
