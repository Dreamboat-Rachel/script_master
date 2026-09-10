import type { DashboardData, ImageSettings, LlmSettings, PipelineData, Project, ProjectDetail, RenderJob, Shot, Subject, SubjectImageInput, VideoAudioMode, VideoSettings, VideoSpeechRate } from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options?.headers },
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
      : typeof payload.details === "string" ? payload.details : "";
    throw new Error(details ? `${payload?.error ?? "请求失败"}（${details}）` : payload?.error ?? `请求失败（HTTP ${response.status}）`);
  }
  return payload;
}

export const api = {
  llmSettings: async () => (await request<{ data: LlmSettings }>("/api/settings/llm")).data,
  saveLlmSettings: async (input: { apiKey?: string; model?: string; apiBase?: string }) => (await request<{ data: LlmSettings }>("/api/settings/llm", { method: "PUT", body: JSON.stringify(input) })).data,
  imageSettings: async () => (await request<{ data: ImageSettings }>("/api/settings/image")).data,
  saveImageSettings: async (input: { provider: ImageSettings["provider"]; apiKey?: string; model: string; apiBase: string }) => (await request<{ data: ImageSettings }>("/api/settings/image", { method: "PUT", body: JSON.stringify(input) })).data,
  videoSettings: async () => (await request<{ data: VideoSettings }>("/api/settings/video")).data,
  saveVideoSettings: async (input: { provider: VideoSettings["provider"]; apiKey?: string; model: VideoSettings["model"]; apiBase: string }) => (await request<{ data: VideoSettings }>("/api/settings/video", { method: "PUT", body: JSON.stringify(input) })).data,
  dashboard: () => request<DashboardData>("/api/dashboard"),
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
  updateProject: async (id: string, input: { title: string; logline: string; genre: string; style: string; aspectRatio: string; durationSeconds: number; targetEpisodeCount: number }) =>
    (await request<{ data: { project: Project } }>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(input) })).data.project,
  generateScript: async (id: string, input: { title: string; logline: string; genre: string; style: string; aspectRatio: string; durationSeconds: number; targetEpisodeCount: number }) =>
    (await request<{ data: { project: Project; scriptText: string; document: PipelineData["document"] } }>(`/api/projects/${id}/generate-script`, {
      method: "POST",
      body: JSON.stringify(input),
    })).data,
  render: async (id: string, input: { shotId?: string; referenceSubjectIds?: string[]; model?: VideoSettings["model"]; duration?: number; prompt?: string; audioMode?: VideoAudioMode; speechRate?: VideoSpeechRate; bgm?: boolean; continuity?: boolean } = {}) =>
    (await request<{ data: RenderJob }>(`/api/projects/${id}/render`, { method: "POST", body: JSON.stringify(input) })).data,
  updateShot: async (projectId: string, shotId: string, input: { location: string; action: string; visualPrompt: string }) =>
    (await request<{ data: Shot }>(`/api/projects/${projectId}/shots/${shotId}`, { method: "PATCH", body: JSON.stringify(input) })).data,
  pipeline: async (id: string) => (await request<{ data: PipelineData }>(`/api/projects/${id}/pipeline`)).data,
  format: async (id: string, text: string) => (await request<{ data: { project: Project; document: PipelineData["document"] } }>(`/api/projects/${id}/format`, { method: "POST", body: JSON.stringify({ text }) })).data,
  extractEpisodes: async (id: string) => (await request<{ data: { project: Project; episodes: PipelineData["episodes"] } }>(`/api/projects/${id}/episodes/extract`, { method: "POST", body: "{}" })).data,
  extractSubjects: async (id: string) => (await request<{ data: { project: Project; subjects: PipelineData["subjects"] } }>(`/api/projects/${id}/subjects/extract`, { method: "POST", body: "{}" })).data,
  deleteSubject: async (projectId: string, subjectId: string) => (await request<{ data: { project: Project; subjects: PipelineData["subjects"] } }>(`/api/projects/${projectId}/subjects/${subjectId}`, { method: "DELETE" })).data,
  generateSubjectImage: async (projectId: string, subjectId: string, input: SubjectImageInput) => (await request<{ data: { subject: Subject; provider: string; model: string; size: string } }>(`/api/projects/${projectId}/subjects/${subjectId}/image`, { method: "POST", body: JSON.stringify(input) })).data,
  extractShots: async (id: string) => (await request<{ data: { project: Project; shots: PipelineData["shots"] } }>(`/api/projects/${id}/shots/extract`, { method: "POST", body: "{}" })).data,
};
