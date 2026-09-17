import type { AssetLibraryData, CharacterImageResult, DashboardData, DigitalHumanLiveSession, DigitalHumanServiceStatus, ImageSettings, ImageUpscaleResolution, ImageUpscaleResult, LlmSettings, PipelineData, Project, ProjectDetail, RenderJob, Shot, ShotContinuityPreview, StudioAssetType, StudioVideoInput, StudioVideoResult, StudioVideoType, Subject, SubjectImageInput, TextToSpeechInput, TextToSpeechList, TextToSpeechResult, VideoAudioMode, VideoContinuityMode, VideoMerge, VideoSettings, VideoSpeechRate, VoiceCloneInput, VoiceCloneList, VoiceCloneResult } from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const isFormData = options?.body instanceof FormData;
  const response = await fetch(url, {
    headers: { ...(!isFormData ? { "Content-Type": "application/json" } : {}), ...options?.headers },
    ...options,
  });
  let payload: any = null;
  if (response.status !== 204) {
    const raw = await response.text();
    if (raw.trim()) {
      try { payload = JSON.parse(raw); }
      catch { throw new Error(`后端返回了无效响应（HTTP ${response.status}）`); }
    }
  }
  if (!response.ok) {
    const details = Array.isArray(payload?.details)
      ? payload.details.map((item: { path?: Array<string | number>; message?: string }) => `${item.path?.join(".") || "参数"}：${item.message || "无效"}`).join("；")
      : typeof payload?.details === "string" ? payload.details : "";
    throw new Error(details ? `${payload?.error ?? "请求失败"}（${details}）` : payload?.error ?? `请求失败（HTTP ${response.status}）`);
  }
  return payload;
}

export const api = {
  llmSettings: async () => (await request<{ data: LlmSettings }>("/api/settings/llm")).data,
  saveLlmSettings: async (input: { apiKey?: string; model?: string; apiBase?: string }) => (await request<{ data: LlmSettings }>("/api/settings/llm", { method: "PUT", body: JSON.stringify(input) })).data,
  imageSettings: async () => (await request<{ data: ImageSettings }>("/api/settings/image")).data,
  saveImageSettings: async (input: { provider: ImageSettings["provider"]; apiKey?: string; model: string; apiBase: string }) => (await request<{ data: ImageSettings }>("/api/settings/image", { method: "PUT", body: JSON.stringify(input) })).data,
  upscaleImage: async (file: File, resolution: ImageUpscaleResolution) => {
    const body = new FormData();
    body.append("file", file);
    body.append("resolution", resolution);
    return (await request<{ data: ImageUpscaleResult }>("/api/tools/image-upscales", { method: "POST", body })).data;
  },
  digitalHumanStatus: async () => (await request<{ data: DigitalHumanServiceStatus }>("/api/tools/digital-human/status")).data,
  createDigitalHumanLive: async (file: File, input: { callMode: "audio" | "video"; persona: string; voice: string }) => {
    const body = new FormData();
    body.append("file", file);
    body.append("callMode", input.callMode);
    body.append("persona", input.persona);
    body.append("voice", input.voice);
    return (await request<{ data: DigitalHumanLiveSession }>("/api/tools/digital-human/lives", { method: "POST", body })).data;
  },
  endDigitalHumanLive: async (liveId: string) => { await request<void>(`/api/tools/digital-human/lives/${encodeURIComponent(liveId)}`, { method: "DELETE" }); },
  videoSettings: async () => (await request<{ data: VideoSettings }>("/api/settings/video")).data,
  saveVideoSettings: async (input: { provider: VideoSettings["provider"]; apiKey?: string; model: VideoSettings["model"]; apiBase: string }) => (await request<{ data: VideoSettings }>("/api/settings/video", { method: "PUT", body: JSON.stringify(input) })).data,
  dashboard: () => request<DashboardData>("/api/dashboard"),
  assets: () => request<AssetLibraryData>("/api/assets"),
  jobs: async () => (await request<{ data: RenderJob[] }>("/api/jobs")).data,
  projects: async () => (await request<{ data: Project[] }>("/api/projects")).data,
  project: async (id: string) => (await request<{ data: ProjectDetail }>(`/api/projects/${id}`)).data,
  createProject: async (input: {
    title: string;
    logline: string;
    genre: string;
    style: string;
    aspectRatio: string;
    durationSeconds: number;
    targetEpisodeCount: number;
  }) => (await request<{ data: Project }>("/api/projects", { method: "POST", body: JSON.stringify(input) })).data,
  deleteProject: async (id: string) => { await request<void>(`/api/projects/${id}`, { method: "DELETE" }); },
  updateProject: async (id: string, input: Partial<{ title: string; logline: string; genre: string; style: string; aspectRatio: string; durationSeconds: number; targetEpisodeCount: number }>) =>
    (await request<{ data: Project }>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(input) })).data,
  generateScript: async (id: string, input: { title: string; logline: string; genre: string; style: string; aspectRatio: string; durationSeconds: number; targetEpisodeCount: number }) =>
    (await request<{ data: { project: Project; scriptText: string; document: PipelineData["document"] } }>(`/api/projects/${id}/generate-script`, {
      method: "POST",
      body: JSON.stringify(input),
    })).data,
  render: async (id: string, input: { shotId?: string; referenceSubjectIds?: string[]; model?: VideoSettings["model"]; duration?: number; prompt?: string; audioMode?: VideoAudioMode; speechRate?: VideoSpeechRate; bgm?: boolean; continuityMode?: VideoContinuityMode } = {}) =>
    (await request<{ data: RenderJob }>(`/api/projects/${id}/render`, { method: "POST", body: JSON.stringify(input) })).data,
  videoMerges: async (id: string) => (await request<{ data: VideoMerge[] }>(`/api/projects/${id}/video-merges`)).data,
  mergeVideos: async (id: string, shotIds: string[]) => (await request<{ data: VideoMerge }>(`/api/projects/${id}/video-merges`, { method: "POST", body: JSON.stringify({ shotIds }) })).data,
  updateShot: async (projectId: string, shotId: string, input: { location: string; action: string; visualPrompt: string }) =>
    (await request<{ data: Shot }>(`/api/projects/${projectId}/shots/${shotId}`, { method: "PATCH", body: JSON.stringify(input) })).data,
  shotContinuityPreview: async (projectId: string, shotId: string) =>
    (await request<{ data: ShotContinuityPreview }>(`/api/projects/${projectId}/shots/${shotId}/continuity-preview`)).data,
  pipeline: async (id: string) => (await request<{ data: PipelineData }>(`/api/projects/${id}/pipeline`)).data,
  format: async (id: string, text: string, systemPrompt?: string) => (await request<{ data: { project: Project; document: PipelineData["document"] } }>(`/api/projects/${id}/format`, { method: "POST", body: JSON.stringify({ text, ...(systemPrompt?.trim() ? { systemPrompt: systemPrompt.trim() } : {}) }) })).data,
  extractEpisodes: async (id: string) => (await request<{ data: { project: Project; episodes: PipelineData["episodes"] } }>(`/api/projects/${id}/episodes/extract`, { method: "POST", body: "{}" })).data,
  extractSubjects: async (id: string, input: { episodeId?: string } = {}) => (await request<{ data: { project: Project; subjects: PipelineData["subjects"]; episodeId?: string | null } }>(`/api/projects/${id}/subjects/extract`, { method: "POST", body: JSON.stringify(input) })).data,
  deleteSubject: async (projectId: string, subjectId: string) => (await request<{ data: { project: Project; subjects: PipelineData["subjects"] } }>(`/api/projects/${projectId}/subjects/${subjectId}`, { method: "DELETE" })).data,
  generateSubjectImage: async (projectId: string, subjectId: string, input: SubjectImageInput) => (await request<{ data: { subject: Subject; provider: string; model: string; size: string } }>(`/api/projects/${projectId}/subjects/${subjectId}/image`, { method: "POST", body: JSON.stringify(input) })).data,
  assetImages: async (assetType: StudioAssetType) => (await request<{ data: CharacterImageResult[] }>(`/api/tools/${assetType}-images`)).data,
  generateAssetImage: async (assetType: StudioAssetType, input: SubjectImageInput) => (await request<{ data: CharacterImageResult }>(`/api/tools/${assetType}-images`, { method: "POST", body: JSON.stringify(input) })).data,
  studioVideos: async (videoType: StudioVideoType) => (await request<{ data: StudioVideoResult[] }>(`/api/tools/${videoType}-videos`)).data,
  generateStudioVideo: async (videoType: StudioVideoType, input: StudioVideoInput) => (await request<{ data: StudioVideoResult }>(`/api/tools/${videoType}-videos`, { method: "POST", body: JSON.stringify(input) })).data,
  studioVideo: async (videoType: StudioVideoType, id: string) => (await request<{ data: StudioVideoResult }>(`/api/tools/${videoType}-videos/${id}`)).data,
  voiceClones: () => request<VoiceCloneList>("/api/tools/voice-clones"),
  cloneVoice: async (file: File, input: VoiceCloneInput) => {
    const body = new FormData();
    body.append("metadata", JSON.stringify(input));
    body.append("file", file);
    return (await request<{ data: VoiceCloneResult }>("/api/tools/voice-clones", { method: "POST", body })).data;
  },
  speechGenerations: () => request<TextToSpeechList>("/api/tools/text-to-speech"),
  generateSpeech: async (input: TextToSpeechInput) => (await request<{ data: TextToSpeechResult }>("/api/tools/text-to-speech", { method: "POST", body: JSON.stringify(input) })).data,
  extractShots: async (id: string, input: { episodeId?: string; subjectIds?: string[]; systemPrompt?: string; style?: string } = {}) => (await request<{ data: { project: Project; shots: PipelineData["shots"]; episodeId?: string | null } }>(`/api/projects/${id}/shots/extract`, { method: "POST", body: JSON.stringify(input) })).data,
};
