import type { DashboardData, LlmSettings, PipelineData, Project, ProjectDetail, RenderJob } from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const details = Array.isArray(payload?.details)
      ? payload.details.map((item: { path?: Array<string | number>; message?: string }) => `${item.path?.join(".") || "参数"}：${item.message || "无效"}`).join("；")
      : typeof payload.details === "string" ? payload.details : "";
    throw new Error(details ? `${payload?.error ?? "请求失败"}（${details}）` : payload?.error ?? "请求失败");
  }
  return payload;
}

export const api = {
  llmSettings: async () => (await request<{ data: LlmSettings }>("/api/settings/llm")).data,
  saveLlmSettings: async (input: { apiKey?: string; model?: string; apiBase?: string }) => (await request<{ data: LlmSettings }>("/api/settings/llm", { method: "PUT", body: JSON.stringify(input) })).data,
  dashboard: () => request<DashboardData>("/api/dashboard"),
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
  render: async (id: string) =>
    (await request<{ data: RenderJob }>(`/api/projects/${id}/render`, { method: "POST", body: "{}" })).data,
  pipeline: async (id: string) => (await request<{ data: PipelineData }>(`/api/projects/${id}/pipeline`)).data,
  format: async (id: string, text: string) => (await request<{ data: { project: Project; document: PipelineData["document"] } }>(`/api/projects/${id}/format`, { method: "POST", body: JSON.stringify({ text }) })).data,
  extractEpisodes: async (id: string) => (await request<{ data: { project: Project; episodes: PipelineData["episodes"] } }>(`/api/projects/${id}/episodes/extract`, { method: "POST", body: "{}" })).data,
  extractSubjects: async (id: string) => (await request<{ data: { project: Project; subjects: PipelineData["subjects"] } }>(`/api/projects/${id}/subjects/extract`, { method: "POST", body: "{}" })).data,
  extractShots: async (id: string) => (await request<{ data: { project: Project; shots: PipelineData["shots"] } }>(`/api/projects/${id}/shots/extract`, { method: "POST", body: "{}" })).data,
};
