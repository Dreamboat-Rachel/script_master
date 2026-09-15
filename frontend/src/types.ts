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

export interface ProjectDetail extends Project {
  scenes: Scene[];
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
  referenceFallback?: boolean;
}

export interface VideoMerge {
  id: string;
  projectId: string;
  outputUrl: string;
  shotIds: string[];
  durationSeconds: number;
  createdAt: string;
  coverUrl: string | null;
}

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

export interface ImageSettings {
  provider: "volcengine" | "aliyun" | "openai" | "custom";
  model: string;
  apiBase: string;
  configured: boolean;
}

export interface VideoSettings {
  provider: ImageSettings["provider"];
  model: "doubao-seedance-2-0-mini-260615" | "doubao-seedance-2-0-260128" | "doubao-seedance-2-0-fast-260128";
  apiBase: string;
  configured: boolean;
}

export type VideoAudioMode = "dialogue" | "ambient" | "silent";
export type VideoSpeechRate = "slow" | "natural";
export type VideoContinuityMode = "auto" | "continue" | "cut" | "scene";

export interface ShotContinuityPreview {
  status: "ready" | "first-shot" | "missing-video" | "extract-failed";
  previousShotId: string | null;
  tailFrameUrl: string | null;
  message: string;
}

export type ImageResolution = "2K" | "4K";
export type ImageAspectRatio = "1:1" | "16:9" | "9:16" | "3:2" | "2:3" | "4:3" | "3:4";

export interface SubjectImageInput {
  prompt: string;
  model: string;
  resolution: ImageResolution;
  aspectRatio: ImageAspectRatio;
  referenceImage?: string;
  watermark?: boolean;
}

export type StudioAssetType = "character" | "scene" | "prop";
export type StudioVideoType = "reference-video" | "keyframe-video";
export type HomeToolType = StudioAssetType | StudioVideoType | "voice-clone" | "text-to-speech" | "prompt-workshop" | "image-upscale";

export interface CharacterImageResult {
  id: string;
  imageUrl: string;
  model: string;
  size: string;
  prompt: string;
  createdAt: string;
}

export interface StudioVideoInput {
  prompt: string;
  model: VideoSettings["model"];
  ratio: "16:9" | "9:16" | "1:1";
  duration: number;
  generateAudio: boolean;
  watermark: boolean;
  referenceImages?: string[];
  firstFrame?: string;
  lastFrame?: string;
}

export interface StudioVideoResult {
  id: string;
  videoType: StudioVideoType;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  outputUrl: string | null;
  errorMessage: string | null;
  prompt: string;
  model: VideoSettings["model"];
  ratio: StudioVideoInput["ratio"];
  duration: number;
  createdAt: string;
  updatedAt: string;
}

export interface VoiceCloneInput {
  name: string;
  language: "zh-CN" | "zh-HK" | "en-US" | "ja-JP";
  useCase: string;
  duration: number;
  previewText: string;
  sampleText?: string;
}

export interface VoiceCloneResult extends VoiceCloneInput {
  id: string;
  voiceId: string;
  audioUrl: string;
  model: string;
  createdAt: string;
}

export interface VoiceCloneList {
  data: VoiceCloneResult[];
  settings: { configured: boolean; model: string };
}

export type SpeechEmotion = "neutral" | "happy" | "sad" | "angry" | "fearful" | "surprised";
export type SpeechLanguageBoost = "Chinese" | "Chinese,Yue" | "English" | "Japanese";

export interface TextToSpeechInput {
  text: string;
  voiceId: string;
  voiceName: string;
  speed: number;
  volume: number;
  pitch: number;
  emotion: SpeechEmotion;
  languageBoost: SpeechLanguageBoost;
  format: "mp3" | "flac";
  sampleRate: 32000 | 44100;
}

export interface TextToSpeechResult extends TextToSpeechInput {
  id: string;
  audioUrl: string;
  duration: number | null;
  model: string;
  createdAt: string;
}

export interface TextToSpeechList {
  data: TextToSpeechResult[];
  settings: { configured: boolean; model: string };
}

export type AssetLibraryKind = "character" | "scene" | "prop" | "audio" | "video";

export interface AssetLibraryItem {
  id: string;
  kind: AssetLibraryKind;
  source: "project" | "tool";
  mediaType: "image" | "audio" | "video";
  title: string;
  description: string;
  mediaUrl: string;
  thumbnailUrl: string | null;
  projectId: string | null;
  projectTitle: string | null;
  detail: string;
  createdAt: string;
}

export interface AssetLibraryData {
  items: AssetLibraryItem[];
  counts: Record<AssetLibraryKind, number>;
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

export interface PipelineData {
  project: Project;
  document: ScriptDocument | null;
  episodes: Episode[];
  subjects: Subject[];
  shots: Shot[];
}

export interface DashboardData {
  stats: {
    projectCount: number;
    completedCount: number;
    activeRenders: number;
    generatedSeconds: number;
    localVideoCount: number;
    localVideoBytes: number;
  };
  projects: Project[];
  jobs: RenderJob[];
}

export interface LlmSettings {
  model: string;
  apiBase: string;
  configured: boolean;
}
