export type ProjectStatus = "draft" | "scripting" | "storyboarding" | "rendering" | "completed" | "failed";

export interface Project {
  id: string;
  title: string;
  logline: string;
  genre: string;
  style: string;
  aspectRatio: string;
  durationSeconds: number;
  targetEpisodeCount: number;
  status: ProjectStatus;
  progress: number;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VideoSettings {
  provider: "volcengine" | "aliyun" | "openai" | "custom";
  model: "doubao-seedance-2-0-mini-260615" | "doubao-seedance-2-0-260128" | "doubao-seedance-2-0-fast-260128" | "doubao-seedance-2-5-260628";
  apiBase: string;
  configured: boolean;
}

export interface Scene {
  id: string;
  projectId: string;
  sceneOrder: number;
  title: string;
  narration: string;
  visualPrompt: string;
  durationSeconds: number;
  camera: string;
  createdAt: string;
  updatedAt: string;
}

export interface RenderJob {
  id: string;
  projectId: string;
  shotId: string | null;
  providerTaskId: string | null;
  projectTitle: string;
  provider: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  outputUrl: string | null;
  errorMessage: string | null;
  generationPrompt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PipelineStage = "setup" | "format" | "episodes" | "subjects" | "shots" | "render";

export interface ScriptDocument {
  id: string;
  projectId: string;
  originalText: string;
  formattedText: string;
  formatStatus: "raw" | "formatted";
  createdAt: string;
  updatedAt: string;
}

export interface Episode {
  id: string;
  projectId: string;
  episodeNumber: number;
  title: string;
  summary: string;
  hook: string;
  originalText: string;
  plotNodes: string[];
  characters: EpisodeCharacter[];
  sceneCount: number;
  status: "draft" | "ready";
  createdAt: string;
  updatedAt: string;
}

export interface EpisodeCharacter {
  name: string;
  introduction: string;
  costume: string;
  personality: string;
  expressions: string;
  continuityNotes: string;
}

export interface Subject {
  id: string;
  projectId: string;
  name: string;
  role: "character" | "location" | "prop";
  description: string;
  visualPrompt: string;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Shot {
  id: string;
  projectId: string;
  episodeId: string;
  episodeNumber: number;
  shotOrder: number;
  title: string;
  location: string;
  action: string;
  dialogue: string;
  visualPrompt: string;
  camera: string;
  durationSeconds: number;
  status: "draft" | "ready";
  createdAt: string;
  updatedAt: string;
}
