import mysql, { type Pool } from "mysql2/promise";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { Episode, Project, ProjectStatus, RenderJob, Scene, ScriptDocument, Shot, Subject } from "./types.js";

type DbRow = Record<string, any>;

export interface CreateProjectInput {
  title: string;
  logline: string;
  genre: string;
  style: string;
  aspectRatio: string;
  durationSeconds: number;
  targetEpisodeCount: number;
}

export interface UserRecord {
  id: string;
  account: string;
  passwordHash: string;
  passwordSalt: string;
  role: "admin" | "user";
  displayName: string;
  email: string;
  avatarUrl: string;
  createdAt: string;
}

export interface CanvasProjectRecord {
  id: string;
  userId: string;
  name: string;
  nodesJson: string;
  edgesJson: string;
  nodeCount: number;
  version: number;
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCanvasInput {
  name: string;
  nodesJson: string;
  edgesJson: string;
  nodeCount: number;
  sourceId?: string;
}

export interface UpdateCanvasInput {
  name?: string;
  nodesJson?: string;
  edgesJson?: string;
  nodeCount?: number;
}

type UpdateProjectInput = Partial<CreateProjectInput> & { status?: ProjectStatus; progress?: number; coverUrl?: string | null };

export interface DatabaseStore {
  initialize(): Promise<void>;
  countUsers(): Promise<number>;
  countAdmins(): Promise<number>;
  getUserByAccount(account: string): Promise<UserRecord | null>;
  createUser(account: string, passwordHash: string, passwordSalt: string, role: UserRecord["role"]): Promise<UserRecord>;
  bootstrapAdmin(account: string, passwordHash: string, passwordSalt: string): Promise<UserRecord>;
  updateUserProfile(userId: string, input: { displayName: string; email: string; avatarUrl: string }): Promise<UserRecord | null>;
  updateUserPassword(userId: string, passwordHash: string, passwordSalt: string): Promise<void>;
  createSession(userId: string, tokenHash: string, expiresAt: string): Promise<void>;
  getUserBySession(tokenHash: string): Promise<UserRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteUserSessions(userId: string): Promise<void>;
  consumeAuthAttempt(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  resetAuthAttempt(key: string): Promise<void>;
  claimUnownedProjects(userId: string): Promise<number>;
  listCanvases(userId: string): Promise<CanvasProjectRecord[]>;
  getCanvas(userId: string, id: string): Promise<CanvasProjectRecord | null>;
  createCanvas(userId: string, input: CreateCanvasInput): Promise<CanvasProjectRecord>;
  updateCanvas(userId: string, id: string, input: UpdateCanvasInput): Promise<CanvasProjectRecord | null>;
  deleteCanvas(userId: string, id: string): Promise<boolean>;
  listProjects(userId: string): Promise<Project[]>;
  getProject(id: string, userId?: string): Promise<Project | null>;
  createProject(userId: string, input: CreateProjectInput): Promise<Project>;
  deleteProject(id: string, userId: string): Promise<boolean>;
  updateProject(id: string, input: UpdateProjectInput, userId?: string): Promise<Project | null>;
  listScenes(projectId: string): Promise<Scene[]>;
  replaceScenes(projectId: string, scenes: Omit<Scene, "id" | "projectId" | "createdAt" | "updatedAt">[]): Promise<Scene[]>;
  listJobs(userId?: string): Promise<RenderJob[]>;
  createRenderJob(projectId: string, shotId?: string, provider?: string, providerTaskId?: string, status?: RenderJob["status"], progress?: number): Promise<RenderJob>;
  setRenderJobPrompt(id: string, generationPrompt: string): Promise<RenderJob | null>;
  startRenderJob(id: string, providerTaskId: string, status: RenderJob["status"], progress: number): Promise<RenderJob | null>;
  updateRenderJob(id: string, input: { status: RenderJob["status"]; progress: number; outputUrl?: string | null; errorMessage?: string | null }): Promise<RenderJob | null>;
  getScriptDocument(projectId: string): Promise<ScriptDocument | null>;
  saveScriptDocument(projectId: string, originalText: string, formattedText: string, formatStatus?: "raw" | "formatted"): Promise<ScriptDocument>;
  listEpisodes(projectId: string): Promise<Episode[]>;
  replaceEpisodes(projectId: string, episodes: Omit<Episode, "id" | "projectId" | "sceneCount" | "createdAt" | "updatedAt">[]): Promise<Episode[]>;
  listSubjects(projectId: string): Promise<Subject[]>;
  replaceSubjects(projectId: string, subjects: Omit<Subject, "id" | "projectId" | "imageUrl" | "createdAt" | "updatedAt">[]): Promise<Subject[]>;
  deleteSubject(projectId: string, subjectId: string): Promise<boolean>;
  updateSubjectImage(projectId: string, subjectId: string, imageUrl: string): Promise<Subject | null>;
  listShots(projectId: string, episodeNumber?: number): Promise<Shot[]>;
  updateShot(projectId: string, shotId: string, input: Pick<Shot, "location" | "action" | "visualPrompt">): Promise<Shot | null>;
  deleteShot(projectId: string, shotId: string): Promise<boolean>;
  deleteShots(projectId: string): Promise<number>;
  replaceShots(projectId: string, shots: Omit<Shot, "id" | "projectId" | "createdAt" | "updatedAt">[]): Promise<Shot[]>;
  replaceEpisodeShots(projectId: string, episodeId: string, shots: Omit<Shot, "id" | "projectId" | "createdAt" | "updatedAt">[]): Promise<Shot[]>;
}

const now = () => new Date().toISOString();

function toProject(row: DbRow): Project {
  return {
    id: row.id,
    title: row.title,
    logline: row.logline,
    genre: row.genre,
    style: row.style,
    aspectRatio: row.aspect_ratio,
    durationSeconds: Number(row.duration_seconds),
    targetEpisodeCount: Number(row.target_episode_count ?? 3),
    status: row.status,
    progress: Number(row.progress),
    coverUrl: row.cover_url ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function toScene(row: DbRow): Scene {
  return {
    id: row.id,
    projectId: row.project_id,
    sceneOrder: Number(row.scene_order),
    title: row.title,
    narration: row.narration,
    visualPrompt: row.visual_prompt,
    durationSeconds: Number(row.duration_seconds),
    camera: row.camera,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function toJob(row: DbRow): RenderJob {
  return {
    id: row.id,
    projectId: row.project_id,
    shotId: row.shot_id ?? null,
    providerTaskId: row.provider_task_id ?? null,
    projectTitle: row.project_title,
    provider: row.provider,
    status: row.status,
    progress: Number(row.progress),
    outputUrl: row.output_url ?? null,
    errorMessage: row.error_message ?? null,
    generationPrompt: row.generation_prompt ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function withoutSourceAudit(value: string) {
  return value.replace(/\n*【原文逐字归档 \/ SOURCE AUDIT】[\s\S]*$/u, "");
}

function toDocument(row: DbRow): ScriptDocument {
  return { id: row.id, projectId: row.project_id, originalText: row.original_text, formattedText: withoutSourceAudit(row.formatted_text), formatStatus: row.format_status, createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at, updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at };
}

function jsonArray<T>(value: unknown, fallback: T[] = []) {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== "string" || !value.trim()) return fallback;
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed as T[] : fallback; } catch { return fallback; }
}

function toEpisode(row: DbRow): Episode {
  return { id: row.id, projectId: row.project_id, episodeNumber: Number(row.episode_number), title: row.title, summary: row.summary, hook: row.hook ?? "", originalText: row.original_text ?? "", plotNodes: jsonArray<string>(row.plot_nodes), characters: jsonArray(row.characters), sceneCount: Number(row.scene_count ?? 0), status: row.status, createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at, updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at };
}

function toSubject(row: DbRow): Subject {
  return { id: row.id, projectId: row.project_id, name: row.name, role: row.role, description: row.description, visualPrompt: row.visual_prompt, imageUrl: row.image_url ?? null, createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at, updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at };
}

function toShot(row: DbRow): Shot {
  return { id: row.id, projectId: row.project_id, episodeId: row.episode_id, episodeNumber: Number(row.episode_number), shotOrder: Number(row.shot_order), title: row.title, location: row.location, action: row.action, dialogue: row.dialogue, visualPrompt: row.visual_prompt, camera: row.camera, durationSeconds: Number(row.duration_seconds), status: row.status, createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at, updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at };
}

function dateString(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toUser(row: DbRow): UserRecord {
  return {
    id: row.id,
    account: row.account,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    role: row.role === "admin" ? "admin" : "user",
    displayName: row.display_name ?? "",
    email: row.email ?? "",
    avatarUrl: row.avatar_url ?? "",
    createdAt: dateString(row.created_at),
  };
}

function toCanvas(row: DbRow): CanvasProjectRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    nodesJson: typeof row.nodes_json === "string" ? row.nodes_json : JSON.stringify(row.nodes_json ?? []),
    edgesJson: typeof row.edges_json === "string" ? row.edges_json : JSON.stringify(row.edges_json ?? []),
    nodeCount: Number(row.node_count ?? 0),
    version: Number(row.version ?? 1),
    sourceId: row.source_id ?? null,
    createdAt: dateString(row.created_at),
    updatedAt: dateString(row.updated_at),
  };
}

const projectSeeds = [
  {
    id: "8d33ccb4-20f3-41b1-9f60-0e817b1d67f1",
    title: "霓虹失眠症",
    logline: "一名记忆修复师在永夜都市里，发现自己正在修复一段并不存在的人生。",
    genre: "科幻悬疑",
    style: "赛博电影",
    aspectRatio: "16:9",
    durationSeconds: 92,
    targetEpisodeCount: 3,
    status: "storyboarding" as ProjectStatus,
    progress: 68,
    coverUrl: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=1400&q=84",
  },
  {
    id: "65273355-bc2c-4882-ae42-b5ab77c5b81a",
    title: "风穿过旧车站",
    logline: "离开小镇十年后，她在废弃车站收到了一封来自未来的信。",
    genre: "都市情感",
    style: "胶片写实",
    aspectRatio: "16:9",
    durationSeconds: 74,
    targetEpisodeCount: 3,
    status: "completed" as ProjectStatus,
    progress: 100,
    coverUrl: "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1400&q=84",
  },
  {
    id: "d3cb1f83-8ddd-4756-b46f-ced6b6bc748e",
    title: "深海来电",
    logline: "潜航员在海底三千米接到一通来自失踪父亲的电话。",
    genre: "惊悚",
    style: "冷峻纪实",
    aspectRatio: "9:16",
    durationSeconds: 56,
    targetEpisodeCount: 3,
    status: "rendering" as ProjectStatus,
    progress: 36,
    coverUrl: "https://images.unsplash.com/photo-1530053969600-caed2596d242?auto=format&fit=crop&w=1400&q=84",
  },
];

function seedScenes(projectId: string) {
  const stamp = now();
  return [
    [randomUUID(), projectId, 1, "城市醒来", "凌晨四点，霓虹还没有熄灭。", "雨夜未来都市，镜面街道，独行人物，电影光效", 8, "航拍推进", stamp, stamp],
    [randomUUID(), projectId, 2, "记忆诊所", "每一段被删除的回忆，都会在别处留下回声。", "暗色记忆诊所，透明数据幕，人物侧脸特写", 7, "缓慢环绕", stamp, stamp],
    [randomUUID(), projectId, 3, "不存在的档案", "档案里的人，竟然和我有同一双眼睛。", "红色警报灯，悬浮档案照片，惊讶表情，浅景深", 6, "快速推近", stamp, stamp],
  ];
}

class SqliteStore implements DatabaseStore {
  private db: DatabaseSync;

  constructor(databaseUrl: string) {
    const relativePath = databaseUrl.replace("sqlite://", "");
    const dbPath = resolve(process.cwd(), relativePath);
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    try {
      this.db.exec("PRAGMA journal_mode = WAL;");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("database is locked")) throw error;
      console.warn("[database] 数据库正被已有进程使用，沿用当前日志模式继续启动");
    }
  }

  async initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        account TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        display_name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS canvas_projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        nodes_json TEXT NOT NULL DEFAULT '[]',
        edges_json TEXT NOT NULL DEFAULT '[]',
        node_count INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        source_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, source_id)
      );
      CREATE TABLE IF NOT EXISTS auth_rate_limits (
        bucket_key TEXT PRIMARY KEY,
        window_started_at TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        title TEXT NOT NULL,
        logline TEXT NOT NULL DEFAULT '',
        genre TEXT NOT NULL,
        style TEXT NOT NULL,
        aspect_ratio TEXT NOT NULL DEFAULT '16:9',
    duration_seconds INTEGER NOT NULL DEFAULT 60,
        target_episode_count INTEGER NOT NULL DEFAULT 3,
        status TEXT NOT NULL DEFAULT 'draft',
        progress INTEGER NOT NULL DEFAULT 0,
        cover_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scenes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        scene_order INTEGER NOT NULL,
        title TEXT NOT NULL,
        narration TEXT NOT NULL,
        visual_prompt TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL DEFAULT 6,
        camera TEXT NOT NULL DEFAULT '中景',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE(project_id, scene_order)
      );
      CREATE TABLE IF NOT EXISTS render_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        shot_id TEXT,
        provider_task_id TEXT,
        provider TEXT NOT NULL DEFAULT 'mock',
        status TEXT NOT NULL DEFAULT 'queued',
        progress INTEGER NOT NULL DEFAULT 0,
        output_url TEXT,
        error_message TEXT,
        generation_prompt TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS script_documents (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE, original_text TEXT NOT NULL, formatted_text TEXT NOT NULL DEFAULT '',
        format_status TEXT NOT NULL DEFAULT 'raw', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS episodes (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, episode_number INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
        hook TEXT NOT NULL DEFAULT '', original_text TEXT NOT NULL DEFAULT '', plot_nodes TEXT NOT NULL DEFAULT '[]', characters TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, UNIQUE(project_id, episode_number)
      );
      CREATE TABLE IF NOT EXISTS subjects (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, description TEXT NOT NULL,
        visual_prompt TEXT NOT NULL, image_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, UNIQUE(project_id, name, role)
      );
      CREATE TABLE IF NOT EXISTS shots (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, episode_id TEXT NOT NULL, episode_number INTEGER NOT NULL, shot_order INTEGER NOT NULL,
        title TEXT NOT NULL, location TEXT NOT NULL, action TEXT NOT NULL, dialogue TEXT NOT NULL, visual_prompt TEXT NOT NULL,
        camera TEXT NOT NULL, duration_seconds INTEGER NOT NULL DEFAULT 6, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
        UNIQUE(project_id, episode_number, shot_order)
      );
      CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON render_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON user_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_canvas_user_updated ON canvas_projects(user_id, updated_at DESC);
    `);

    for (const statement of [
      "ALTER TABLE projects ADD COLUMN target_episode_count INTEGER NOT NULL DEFAULT 3",
      "ALTER TABLE episodes ADD COLUMN hook TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE episodes ADD COLUMN original_text TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE episodes ADD COLUMN plot_nodes TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE episodes ADD COLUMN characters TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE subjects ADD COLUMN image_url TEXT",
      "ALTER TABLE render_jobs ADD COLUMN shot_id TEXT",
      "ALTER TABLE render_jobs ADD COLUMN provider_task_id TEXT",
      "ALTER TABLE render_jobs ADD COLUMN generation_prompt TEXT",
      "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'",
      "ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE projects ADD COLUMN user_id TEXT",
    ]) { try { this.db.exec(statement); } catch { /* Existing installations already have this column. */ } }

    this.db.exec("CREATE INDEX IF NOT EXISTS idx_projects_user_updated ON projects(user_id, updated_at DESC)");
    const count = this.db.prepare("SELECT COUNT(*) AS total FROM projects").get() as { total: number };
    if (count.total > 0) return;

    const insertProject = this.db.prepare(`
      INSERT INTO projects (id, title, logline, genre, style, aspect_ratio, duration_seconds, target_episode_count, status, progress, cover_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertScene = this.db.prepare(`
      INSERT INTO scenes (id, project_id, scene_order, title, narration, visual_prompt, duration_seconds, camera, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertJob = this.db.prepare(`
      INSERT INTO render_jobs (id, project_id, provider, status, progress, output_url, error_message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec("BEGIN");
    try {
      for (const project of projectSeeds) {
        const stamp = now();
        insertProject.run(project.id, project.title, project.logline, project.genre, project.style, project.aspectRatio, project.durationSeconds, project.targetEpisodeCount, project.status, project.progress, project.coverUrl, stamp, stamp);
      }
      for (const scene of seedScenes(projectSeeds[0].id)) insertScene.run(...scene);
      const stamp = now();
      insertJob.run(randomUUID(), projectSeeds[2].id, "mock-video", "processing", 36, null, null, stamp, stamp);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async countUsers() {
    return Number((this.db.prepare("SELECT COUNT(*) AS total FROM users").get() as { total: number }).total);
  }

  async countAdmins() {
    return Number((this.db.prepare("SELECT COUNT(*) AS total FROM users WHERE role='admin'").get() as { total: number }).total);
  }

  async getUserByAccount(account: string) {
    const row = this.db.prepare("SELECT * FROM users WHERE account = ? COLLATE NOCASE").get(account) as DbRow | undefined;
    return row ? toUser(row) : null;
  }

  async createUser(account: string, passwordHash: string, passwordSalt: string, role: UserRecord["role"]) {
    const id = randomUUID();
    const stamp = now();
    const hasUsers = (this.db.prepare("SELECT COUNT(*) AS total FROM users").get() as { total: number }).total > 0;
    const effectiveRole = role === "admin" && !hasUsers ? "admin" : "user";
    this.db.prepare("INSERT INTO users (id,account,password_hash,password_salt,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(id, account, passwordHash, passwordSalt, effectiveRole, stamp, stamp);
    return (await this.getUserByAccount(account))!;
  }

  async bootstrapAdmin(account: string, passwordHash: string, passwordSalt: string) {
    const existing = await this.getUserByAccount(account);
    const stamp = now();
    if (existing) {
      this.db.prepare("UPDATE users SET password_hash=?,password_salt=?,role='admin',updated_at=? WHERE id=?").run(passwordHash, passwordSalt, stamp, existing.id);
    } else {
      this.db.prepare("INSERT INTO users (id,account,password_hash,password_salt,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(randomUUID(), account, passwordHash, passwordSalt, "admin", stamp, stamp);
    }
    return (await this.getUserByAccount(account))!;
  }

  async updateUserProfile(userId: string, input: { displayName: string; email: string; avatarUrl: string }) {
    this.db.prepare("UPDATE users SET display_name=?,email=?,avatar_url=?,updated_at=? WHERE id=?").run(input.displayName, input.email, input.avatarUrl, now(), userId);
    const row = this.db.prepare("SELECT * FROM users WHERE id=?").get(userId) as DbRow | undefined;
    return row ? toUser(row) : null;
  }

  async updateUserPassword(userId: string, passwordHashValue: string, passwordSalt: string) {
    this.db.prepare("UPDATE users SET password_hash=?,password_salt=?,updated_at=? WHERE id=?").run(passwordHashValue, passwordSalt, now(), userId);
  }

  async createSession(userId: string, tokenHash: string, expiresAt: string) {
    const stamp = now();
    this.db.prepare("DELETE FROM user_sessions WHERE expires_at <= ?").run(stamp);
    this.db.prepare("INSERT INTO user_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)").run(tokenHash, userId, expiresAt, stamp);
  }

  async getUserBySession(tokenHash: string) {
    const row = this.db.prepare(`SELECT u.* FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash, now()) as DbRow | undefined;
    return row ? toUser(row) : null;
  }

  async deleteSession(tokenHash: string) {
    this.db.prepare("DELETE FROM user_sessions WHERE token_hash=?").run(tokenHash);
  }

  async deleteUserSessions(userId: string) {
    this.db.prepare("DELETE FROM user_sessions WHERE user_id=?").run(userId);
  }

  async consumeAuthAttempt(key: string, limit: number, windowSeconds: number) {
    const stamp = new Date();
    const cutoff = new Date(stamp.getTime() - windowSeconds * 1000).toISOString();
    const current = this.db.prepare("SELECT * FROM auth_rate_limits WHERE bucket_key=?").get(key) as DbRow | undefined;
    const count = !current || String(current.window_started_at) <= cutoff ? 1 : Number(current.attempt_count) + 1;
    const windowStartedAt = !current || String(current.window_started_at) <= cutoff ? stamp.toISOString() : String(current.window_started_at);
    this.db.prepare(`INSERT INTO auth_rate_limits (bucket_key,window_started_at,attempt_count) VALUES (?,?,?) ON CONFLICT(bucket_key) DO UPDATE SET window_started_at=excluded.window_started_at,attempt_count=excluded.attempt_count`).run(key, windowStartedAt, count);
    const retryAfterSeconds = Math.max(1, Math.ceil((new Date(windowStartedAt).getTime() + windowSeconds * 1000 - stamp.getTime()) / 1000));
    return { allowed: count <= limit, retryAfterSeconds };
  }

  async resetAuthAttempt(key: string) {
    this.db.prepare("DELETE FROM auth_rate_limits WHERE bucket_key=?").run(key);
  }

  async claimUnownedProjects(userId: string) {
    const result = this.db.prepare("UPDATE projects SET user_id=? WHERE user_id IS NULL").run(userId) as { changes: number | bigint };
    return Number(result.changes);
  }

  async listCanvases(userId: string) {
    const rows = this.db.prepare("SELECT * FROM canvas_projects WHERE user_id=? ORDER BY updated_at DESC").all(userId) as DbRow[];
    return rows.map(toCanvas);
  }

  async getCanvas(userId: string, id: string) {
    const row = this.db.prepare("SELECT * FROM canvas_projects WHERE id=? AND user_id=?").get(id, userId) as DbRow | undefined;
    return row ? toCanvas(row) : null;
  }

  async createCanvas(userId: string, input: CreateCanvasInput) {
    if (input.sourceId) {
      const existing = this.db.prepare("SELECT * FROM canvas_projects WHERE user_id=? AND source_id=?").get(userId, input.sourceId) as DbRow | undefined;
      if (existing) return toCanvas(existing);
    }
    const id = randomUUID();
    const stamp = now();
    this.db.prepare(`INSERT INTO canvas_projects (id,user_id,name,nodes_json,edges_json,node_count,version,source_id,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?,?)`).run(id, userId, input.name, input.nodesJson, input.edgesJson, input.nodeCount, input.sourceId ?? null, stamp, stamp);
    return (await this.getCanvas(userId, id))!;
  }

  async updateCanvas(userId: string, id: string, input: UpdateCanvasInput) {
    const current = await this.getCanvas(userId, id);
    if (!current) return null;
    const next = { ...current, ...input };
    this.db.prepare(`UPDATE canvas_projects SET name=?,nodes_json=?,edges_json=?,node_count=?,version=version+1,updated_at=? WHERE id=? AND user_id=?`).run(next.name, next.nodesJson, next.edgesJson, next.nodeCount, now(), id, userId);
    return this.getCanvas(userId, id);
  }

  async deleteCanvas(userId: string, id: string) {
    const result = this.db.prepare("DELETE FROM canvas_projects WHERE id=? AND user_id=?").run(id, userId) as { changes: number | bigint };
    return Number(result.changes) > 0;
  }

  async listProjects(userId: string) {
    return (this.db.prepare("SELECT * FROM projects WHERE user_id=? ORDER BY updated_at DESC").all(userId) as DbRow[]).map(toProject);
  }

  async getProject(id: string, userId?: string) {
    const row = userId
      ? this.db.prepare("SELECT * FROM projects WHERE id=? AND user_id=?").get(id, userId) as DbRow | undefined
      : this.db.prepare("SELECT * FROM projects WHERE id=?").get(id) as DbRow | undefined;
    return row ? toProject(row) : null;
  }

  async createProject(userId: string, input: CreateProjectInput) {
    const id = randomUUID();
    const stamp = now();
    this.db.prepare(`
      INSERT INTO projects (id, user_id, title, logline, genre, style, aspect_ratio, duration_seconds, target_episode_count, status, progress, cover_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 8, NULL, ?, ?)
    `).run(id, userId, input.title, input.logline, input.genre, input.style, input.aspectRatio, input.durationSeconds, input.targetEpisodeCount, stamp, stamp);
    return (await this.getProject(id, userId))!;
  }

  async deleteProject(id: string, userId: string) {
    const result = this.db.prepare("DELETE FROM projects WHERE id=? AND user_id=?").run(id, userId) as { changes: number | bigint };
    return Number(result.changes) > 0;
  }

  async updateProject(id: string, input: UpdateProjectInput, userId?: string) {
    const current = await this.getProject(id, userId);
    if (!current) return null;
    const next = { ...current, ...input, updatedAt: now() };
    const sql = `UPDATE projects SET title=?,logline=?,genre=?,style=?,aspect_ratio=?,duration_seconds=?,target_episode_count=?,status=?,progress=?,cover_url=?,updated_at=? WHERE id=?${userId ? " AND user_id=?" : ""}`;
    this.db.prepare(sql).run(next.title, next.logline, next.genre, next.style, next.aspectRatio, next.durationSeconds, next.targetEpisodeCount ?? 3, next.status, next.progress, next.coverUrl, next.updatedAt, id, ...(userId ? [userId] : []));
    return this.getProject(id, userId);
  }

  async listScenes(projectId: string) {
    return (this.db.prepare("SELECT * FROM scenes WHERE project_id = ? ORDER BY scene_order").all(projectId) as DbRow[]).map(toScene);
  }

  async replaceScenes(projectId: string, scenes: Omit<Scene, "id" | "projectId" | "createdAt" | "updatedAt">[]) {
    const remove = this.db.prepare("DELETE FROM scenes WHERE project_id = ?");
    const insert = this.db.prepare(`
      INSERT INTO scenes (id, project_id, scene_order, title, narration, visual_prompt, duration_seconds, camera, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec("BEGIN");
    try {
      remove.run(projectId);
      for (const scene of scenes) {
        const stamp = now();
        insert.run(randomUUID(), projectId, scene.sceneOrder, scene.title, scene.narration, scene.visualPrompt, scene.durationSeconds, scene.camera, stamp, stamp);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.listScenes(projectId);
  }

  async listJobs(userId?: string) {
    return (this.db.prepare(`
      SELECT j.*, p.title AS project_title FROM render_jobs j
      JOIN projects p ON p.id = j.project_id ${userId ? "WHERE p.user_id=?" : ""} ORDER BY j.created_at DESC
    `).all(...(userId ? [userId] : [])) as DbRow[]).map(toJob);
  }

  async createRenderJob(projectId: string, shotId?: string, provider = "mock-video", providerTaskId?: string, status = "queued" as RenderJob["status"], progress = 3) {
    const id = randomUUID();
    const stamp = now();
    this.db.prepare(`
      INSERT INTO render_jobs (id, project_id, shot_id, provider, provider_task_id, status, progress, output_url, error_message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    `).run(id, projectId, shotId ?? null, provider, providerTaskId ?? null, status, progress, stamp, stamp);
    const row = this.db.prepare(`
      SELECT j.*, p.title AS project_title FROM render_jobs j JOIN projects p ON p.id = j.project_id WHERE j.id = ?
    `).get(id) as DbRow;
    return toJob(row);
  }

  async setRenderJobPrompt(id: string, generationPrompt: string) {
    const stamp = now();
    this.db.prepare("UPDATE render_jobs SET generation_prompt=?, updated_at=? WHERE id=?").run(generationPrompt, stamp, id);
    const row = this.db.prepare("SELECT j.*, p.title AS project_title FROM render_jobs j JOIN projects p ON p.id = j.project_id WHERE j.id = ?").get(id) as DbRow | undefined;
    return row ? toJob(row) : null;
  }

  async startRenderJob(id: string, providerTaskId: string, status: RenderJob["status"], progress: number) {
    const stamp = now();
    this.db.prepare(`UPDATE render_jobs SET provider_task_id=?, status=?, progress=?, error_message=NULL, updated_at=? WHERE id=?`)
      .run(providerTaskId, status, progress, stamp, id);
    const row = this.db.prepare(`SELECT j.*, p.title AS project_title FROM render_jobs j JOIN projects p ON p.id = j.project_id WHERE j.id = ?`).get(id) as DbRow | undefined;
    return row ? toJob(row) : null;
  }

  async updateRenderJob(id: string, input: { status: RenderJob["status"]; progress: number; outputUrl?: string | null; errorMessage?: string | null }) {
    const stamp = now();
    this.db.prepare(`UPDATE render_jobs SET status=?, progress=?, output_url=?, error_message=?, updated_at=? WHERE id=?`)
      .run(input.status, input.progress, input.outputUrl ?? null, input.errorMessage ?? null, stamp, id);
    const row = this.db.prepare(`SELECT j.*, p.title AS project_title FROM render_jobs j JOIN projects p ON p.id = j.project_id WHERE j.id = ?`).get(id) as DbRow | undefined;
    return row ? toJob(row) : null;
  }

  async getScriptDocument(projectId: string) {
    const row = this.db.prepare("SELECT * FROM script_documents WHERE project_id = ?").get(projectId) as DbRow | undefined;
    return row ? toDocument(row) : null;
  }

  async saveScriptDocument(projectId: string, originalText: string, formattedText: string, formatStatus: "raw" | "formatted" = "formatted") {
    const existing = await this.getScriptDocument(projectId);
    const id = existing?.id ?? randomUUID();
    const stamp = now();
    this.db.prepare(`INSERT INTO script_documents (id,project_id,original_text,formatted_text,format_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET original_text=excluded.original_text,formatted_text=excluded.formatted_text,format_status=excluded.format_status,updated_at=excluded.updated_at`)
      .run(id, projectId, originalText, formattedText, formatStatus, existing?.createdAt ?? stamp, stamp);
    return (await this.getScriptDocument(projectId))!;
  }

  async listEpisodes(projectId: string) {
    const rows = this.db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM shots s WHERE s.episode_id=e.id) AS scene_count FROM episodes e WHERE e.project_id=? ORDER BY episode_number`).all(projectId) as DbRow[];
    return rows.map(toEpisode);
  }

  async replaceEpisodes(projectId: string, episodes: Omit<Episode, "id" | "projectId" | "sceneCount" | "createdAt" | "updatedAt">[]) {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM episodes WHERE project_id=?").run(projectId);
      const insert = this.db.prepare(`INSERT INTO episodes (id,project_id,episode_number,title,summary,hook,original_text,plot_nodes,characters,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const episode of episodes) { const stamp = now(); insert.run(randomUUID(), projectId, episode.episodeNumber, episode.title, episode.summary, episode.hook, episode.originalText, JSON.stringify(episode.plotNodes), JSON.stringify(episode.characters), episode.status, stamp, stamp); }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.listEpisodes(projectId);
  }

  async listSubjects(projectId: string) {
    return (this.db.prepare("SELECT * FROM subjects WHERE project_id=? ORDER BY role,name").all(projectId) as DbRow[]).map(toSubject);
  }

  async replaceSubjects(projectId: string, subjects: Omit<Subject, "id" | "projectId" | "imageUrl" | "createdAt" | "updatedAt">[]) {
    this.db.exec("BEGIN");
    try {
      const existing = this.db.prepare("SELECT id,name,role FROM subjects WHERE project_id=?").all(projectId) as DbRow[];
      const existingByKey = new Map(existing.map((row) => [`${row.role}:${row.name}`, row]));
      const retainedIds = new Set<string>();
      const update = this.db.prepare("UPDATE subjects SET description=?,visual_prompt=?,updated_at=? WHERE id=? AND project_id=?");
      const insert = this.db.prepare(`INSERT INTO subjects (id,project_id,name,role,description,visual_prompt,image_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const subject of subjects) {
        const existingRow = existingByKey.get(`${subject.role}:${subject.name}`);
        const stamp = now();
        if (existingRow) {
          retainedIds.add(String(existingRow.id));
          update.run(subject.description, subject.visualPrompt, stamp, existingRow.id, projectId);
        } else {
          const id = randomUUID();
          retainedIds.add(id);
          insert.run(id, projectId, subject.name, subject.role, subject.description, subject.visualPrompt, null, stamp, stamp);
        }
      }
      for (const row of existing) if (!retainedIds.has(String(row.id))) this.db.prepare("DELETE FROM subjects WHERE id=? AND project_id=?").run(row.id, projectId);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.listSubjects(projectId);
  }

  async deleteSubject(projectId: string, subjectId: string) {
    const result = this.db.prepare("DELETE FROM subjects WHERE id=? AND project_id=?").run(subjectId, projectId) as { changes: number | bigint };
    return Number(result.changes) > 0;
  }

  async updateSubjectImage(projectId: string, subjectId: string, imageUrl: string) {
    const stamp = now();
    const result = this.db.prepare("UPDATE subjects SET image_url=?, updated_at=? WHERE id=? AND project_id=?").run(imageUrl, stamp, subjectId, projectId) as { changes: number | bigint };
    if (!Number(result.changes)) return null;
    return toSubject(this.db.prepare("SELECT * FROM subjects WHERE id=? AND project_id=?").get(subjectId, projectId) as DbRow);
  }

  async listShots(projectId: string, episodeNumber?: number) {
    const rows = this.db.prepare(`SELECT * FROM shots WHERE project_id=? ${episodeNumber ? "AND episode_number=?" : ""} ORDER BY episode_number,shot_order`).all(...(episodeNumber ? [projectId, episodeNumber] : [projectId])) as DbRow[];
    return rows.map(toShot);
  }

  async updateShot(projectId: string, shotId: string, input: Pick<Shot, "location" | "action" | "visualPrompt">) {
    const stamp = now();
    const result = this.db.prepare("UPDATE shots SET location=?, action=?, visual_prompt=?, updated_at=? WHERE id=? AND project_id=?").run(input.location, input.action, input.visualPrompt, stamp, shotId, projectId) as { changes: number | bigint };
    if (!Number(result.changes)) return null;
    const row = this.db.prepare("SELECT * FROM shots WHERE id=? AND project_id=?").get(shotId, projectId) as DbRow | undefined;
    return row ? toShot(row) : null;
  }

  async deleteShot(projectId: string, shotId: string) {
    const row = this.db.prepare("SELECT episode_number FROM shots WHERE id=? AND project_id=?").get(shotId, projectId) as DbRow | undefined;
    if (!row) return false;
    const episodeNumber = Number(row.episode_number);
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM render_jobs WHERE project_id=? AND shot_id=?").run(projectId, shotId);
      this.db.prepare("DELETE FROM shots WHERE id=? AND project_id=?").run(shotId, projectId);
      this.db.prepare("UPDATE shots SET shot_order=shot_order+1000000 WHERE project_id=? AND episode_number=?").run(projectId, episodeNumber);
      const remaining = this.db.prepare("SELECT id FROM shots WHERE project_id=? AND episode_number=? ORDER BY shot_order").all(projectId, episodeNumber) as DbRow[];
      const update = this.db.prepare("UPDATE shots SET shot_order=?, updated_at=? WHERE id=? AND project_id=?");
      remaining.forEach((shot, index) => update.run(index + 1, now(), shot.id, projectId));
      this.db.exec("COMMIT");
      return true;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  async deleteShots(projectId: string) {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM render_jobs WHERE project_id=? AND shot_id IS NOT NULL").run(projectId);
      const result = this.db.prepare("DELETE FROM shots WHERE project_id=?").run(projectId) as { changes: number | bigint };
      this.db.exec("COMMIT");
      return Number(result.changes);
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  async replaceShots(projectId: string, shots: Omit<Shot, "id" | "projectId" | "createdAt" | "updatedAt">[]) {
    this.db.prepare("DELETE FROM shots WHERE project_id=?").run(projectId);
    const insert = this.db.prepare(`INSERT INTO shots (id,project_id,episode_id,episode_number,shot_order,title,location,action,dialogue,visual_prompt,camera,duration_seconds,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const shot of shots) { const stamp = now(); insert.run(randomUUID(), projectId, shot.episodeId, shot.episodeNumber, shot.shotOrder, shot.title, shot.location, shot.action, shot.dialogue, shot.visualPrompt, shot.camera, shot.durationSeconds, shot.status, stamp, stamp); }
    return this.listShots(projectId);
  }

  async replaceEpisodeShots(projectId: string, episodeId: string, shots: Omit<Shot, "id" | "projectId" | "createdAt" | "updatedAt">[]) {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM shots WHERE project_id=? AND episode_id=?").run(projectId, episodeId);
      const insert = this.db.prepare(`INSERT INTO shots (id,project_id,episode_id,episode_number,shot_order,title,location,action,dialogue,visual_prompt,camera,duration_seconds,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const shot of shots) { const stamp = now(); insert.run(randomUUID(), projectId, shot.episodeId, shot.episodeNumber, shot.shotOrder, shot.title, shot.location, shot.action, shot.dialogue, shot.visualPrompt, shot.camera, shot.durationSeconds, shot.status, stamp, stamp); }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.listShots(projectId, shots[0]?.episodeNumber);
  }
}

class MysqlStore implements DatabaseStore {
  private pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 8, charset: "utf8mb4" });
  }

  async initialize() {
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY, account VARCHAR(80) NOT NULL, password_hash VARCHAR(128) NOT NULL, password_salt VARCHAR(128) NOT NULL,
      role VARCHAR(16) NOT NULL DEFAULT 'user', display_name VARCHAR(80) NOT NULL DEFAULT '', email VARCHAR(254) NOT NULL DEFAULT '', avatar_url VARCHAR(2000) NOT NULL DEFAULT '',
      created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      UNIQUE KEY uq_users_account (account)
    ) ENGINE=InnoDB`);
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL, expires_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, INDEX idx_sessions_expires_at (expires_at)
    ) ENGINE=InnoDB`);
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS canvas_projects (
      id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, name VARCHAR(120) NOT NULL,
      nodes_json LONGTEXT NOT NULL, edges_json LONGTEXT NOT NULL, node_count INT UNSIGNED NOT NULL DEFAULT 0,
      version INT UNSIGNED NOT NULL DEFAULT 1, source_id VARCHAR(100) NULL,
      created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY uq_canvas_source (user_id, source_id), INDEX idx_canvas_user_updated (user_id, updated_at DESC)
    ) ENGINE=InnoDB`);
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS auth_rate_limits (
      bucket_key CHAR(64) PRIMARY KEY, window_started_at DATETIME(3) NOT NULL, attempt_count INT UNSIGNED NOT NULL DEFAULT 0
    ) ENGINE=InnoDB`);
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS projects (
      id CHAR(36) PRIMARY KEY, user_id CHAR(36) NULL, title VARCHAR(120) NOT NULL, logline VARCHAR(5000) NOT NULL DEFAULT '',
      genre VARCHAR(40) NOT NULL, style VARCHAR(40) NOT NULL, aspect_ratio VARCHAR(10) NOT NULL DEFAULT '16:9',
      duration_seconds INT UNSIGNED NOT NULL DEFAULT 60, target_episode_count INT UNSIGNED NOT NULL DEFAULT 3, status VARCHAR(24) NOT NULL DEFAULT 'draft',
      progress TINYINT UNSIGNED NOT NULL DEFAULT 0, cover_url VARCHAR(1000) NULL,
      created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, INDEX idx_projects_updated_at (updated_at DESC)
    ) ENGINE=InnoDB`);
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS scenes (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, scene_order INT UNSIGNED NOT NULL,
      title VARCHAR(120) NOT NULL, narration TEXT NOT NULL, visual_prompt TEXT NOT NULL,
      duration_seconds INT UNSIGNED NOT NULL DEFAULT 6, camera VARCHAR(80) NOT NULL DEFAULT '中景',
      created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, UNIQUE KEY uq_scene_order (project_id, scene_order)
    ) ENGINE=InnoDB`);
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS render_jobs (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, shot_id CHAR(36) NULL, provider_task_id VARCHAR(200) NULL, provider VARCHAR(40) NOT NULL DEFAULT 'mock',
      status VARCHAR(24) NOT NULL DEFAULT 'queued', progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
      output_url VARCHAR(1000) NULL, error_message TEXT NULL, generation_prompt LONGTEXT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, INDEX idx_jobs_status (status)
    ) ENGINE=InnoDB`);
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS script_documents (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL UNIQUE, original_text LONGTEXT NOT NULL, formatted_text LONGTEXT NOT NULL,
      format_status VARCHAR(20) NOT NULL DEFAULT 'raw', created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS episodes (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, episode_number INT UNSIGNED NOT NULL, title VARCHAR(120) NOT NULL,
      summary TEXT NOT NULL, hook TEXT NOT NULL, original_text LONGTEXT NOT NULL, plot_nodes JSON NOT NULL, characters JSON NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft', created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, UNIQUE KEY uq_episode_number (project_id,episode_number)
    ) ENGINE=InnoDB`);
    for (const statement of [
      "ALTER TABLE projects MODIFY COLUMN logline VARCHAR(5000) NOT NULL DEFAULT ''",
      "ALTER TABLE projects ADD COLUMN target_episode_count INT UNSIGNED NOT NULL DEFAULT 3",
      "ALTER TABLE episodes ADD COLUMN hook TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE episodes ADD COLUMN original_text LONGTEXT NOT NULL",
      "ALTER TABLE episodes ADD COLUMN plot_nodes JSON NOT NULL",
      "ALTER TABLE episodes ADD COLUMN characters JSON NOT NULL",
      "ALTER TABLE render_jobs ADD COLUMN shot_id CHAR(36) NULL",
      "ALTER TABLE render_jobs ADD COLUMN provider_task_id VARCHAR(200) NULL",
      "ALTER TABLE render_jobs ADD COLUMN generation_prompt LONGTEXT NULL",
      "ALTER TABLE users ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'user'",
      "ALTER TABLE users ADD COLUMN display_name VARCHAR(80) NOT NULL DEFAULT ''",
      "ALTER TABLE users ADD COLUMN email VARCHAR(254) NOT NULL DEFAULT ''",
      "ALTER TABLE users ADD COLUMN avatar_url VARCHAR(2000) NOT NULL DEFAULT ''",
      "ALTER TABLE projects ADD COLUMN user_id CHAR(36) NULL",
      "ALTER TABLE projects ADD INDEX idx_projects_user_updated (user_id, updated_at DESC)",
      "ALTER TABLE projects ADD CONSTRAINT fk_projects_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
    ]) { try { await this.pool.execute(statement); } catch { /* Existing installations already have this column. */ } }
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS subjects (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, name VARCHAR(120) NOT NULL, role VARCHAR(20) NOT NULL,
      description TEXT NOT NULL, visual_prompt TEXT NOT NULL, image_url VARCHAR(1000) NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    try { await this.pool.execute("ALTER TABLE subjects ADD COLUMN image_url VARCHAR(1000) NULL"); } catch { /* Existing installations already have this column. */ }
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS shots (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, episode_id CHAR(36) NOT NULL, episode_number INT UNSIGNED NOT NULL,
      shot_order INT UNSIGNED NOT NULL, title VARCHAR(120) NOT NULL, location VARCHAR(160) NOT NULL, action TEXT NOT NULL,
      dialogue TEXT NOT NULL, visual_prompt TEXT NOT NULL, camera VARCHAR(80) NOT NULL, duration_seconds INT UNSIGNED NOT NULL DEFAULT 6,
      status VARCHAR(20) NOT NULL DEFAULT 'draft', created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
      UNIQUE KEY uq_shot_order (project_id,episode_number,shot_order)
    ) ENGINE=InnoDB`);

    const [rows] = await this.pool.query("SELECT COUNT(*) AS total FROM projects");
    if (Number((rows as DbRow[])[0].total) > 0) return;
    for (const project of projectSeeds) {
      const stamp = new Date();
      await this.pool.execute(`INSERT INTO projects
        (id,title,logline,genre,style,aspect_ratio,duration_seconds,target_episode_count,status,progress,cover_url,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [project.id, project.title, project.logline, project.genre, project.style, project.aspectRatio, project.durationSeconds, project.targetEpisodeCount, project.status, project.progress, project.coverUrl, stamp, stamp]);
    }
    for (const scene of seedScenes(projectSeeds[0].id)) {
      await this.pool.execute(`INSERT INTO scenes
        (id,project_id,scene_order,title,narration,visual_prompt,duration_seconds,camera,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, [...scene.slice(0, 8), new Date(String(scene[8])), new Date(String(scene[9]))]);
    }
    const stamp = new Date();
    await this.pool.execute(`INSERT INTO render_jobs
      (id,project_id,provider,status,progress,output_url,error_message,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    [randomUUID(), projectSeeds[2].id, "mock-video", "processing", 36, null, null, stamp, stamp]);
  }

  async getUserByAccount(account: string) {
    const [rows] = await this.pool.execute("SELECT * FROM users WHERE account=?", [account]);
    const row = (rows as DbRow[])[0];
    return row ? toUser(row) : null;
  }

  async countUsers() {
    const [rows] = await this.pool.query("SELECT COUNT(*) AS total FROM users");
    return Number((rows as DbRow[])[0].total);
  }

  async countAdmins() {
    const [rows] = await this.pool.query("SELECT COUNT(*) AS total FROM users WHERE role='admin'");
    return Number((rows as DbRow[])[0].total);
  }

  async createUser(account: string, passwordHash: string, passwordSalt: string, role: UserRecord["role"]) {
    const id = randomUUID();
    const stamp = new Date();
    const connection = await this.pool.getConnection();
    try {
      const [lockRows] = await connection.query("SELECT GET_LOCK('script_master_first_user', 5) AS acquired");
      if (Number((lockRows as DbRow[])[0].acquired) !== 1) throw new Error("账号注册繁忙，请稍后重试");
      const [countRows] = await connection.query("SELECT COUNT(*) AS total FROM users");
      const hasUsers = Number((countRows as DbRow[])[0].total) > 0;
      const effectiveRole = role === "admin" && !hasUsers ? "admin" : "user";
      await connection.execute("INSERT INTO users (id,account,password_hash,password_salt,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", [id, account, passwordHash, passwordSalt, effectiveRole, stamp, stamp]);
    } finally {
      await connection.query("SELECT RELEASE_LOCK('script_master_first_user')").catch(() => undefined);
      connection.release();
    }
    return (await this.getUserByAccount(account))!;
  }

  async bootstrapAdmin(account: string, passwordHash: string, passwordSalt: string) {
    const stamp = new Date();
    const connection = await this.pool.getConnection();
    try {
      const [lockRows] = await connection.query("SELECT GET_LOCK('script_master_admin_bootstrap', 5) AS acquired");
      if (Number((lockRows as DbRow[])[0].acquired) !== 1) throw new Error("管理员初始化繁忙，请稍后重试");
      await connection.execute(`INSERT INTO users (id,account,password_hash,password_salt,role,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash),password_salt=VALUES(password_salt),role='admin',updated_at=VALUES(updated_at)`,
      [randomUUID(), account, passwordHash, passwordSalt, "admin", stamp, stamp]);
    } finally {
      await connection.query("SELECT RELEASE_LOCK('script_master_admin_bootstrap')").catch(() => undefined);
      connection.release();
    }
    return (await this.getUserByAccount(account))!;
  }

  async updateUserProfile(userId: string, input: { displayName: string; email: string; avatarUrl: string }) {
    await this.pool.execute("UPDATE users SET display_name=?,email=?,avatar_url=?,updated_at=? WHERE id=?", [input.displayName, input.email, input.avatarUrl, new Date(), userId]);
    const [rows] = await this.pool.execute("SELECT * FROM users WHERE id=?", [userId]);
    const row = (rows as DbRow[])[0];
    return row ? toUser(row) : null;
  }

  async updateUserPassword(userId: string, passwordHashValue: string, passwordSalt: string) {
    await this.pool.execute("UPDATE users SET password_hash=?,password_salt=?,updated_at=? WHERE id=?", [passwordHashValue, passwordSalt, new Date(), userId]);
  }

  async createSession(userId: string, tokenHash: string, expiresAt: string) {
    await this.pool.execute("DELETE FROM user_sessions WHERE expires_at <= ?", [new Date()]);
    await this.pool.execute("INSERT INTO user_sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)", [tokenHash, userId, new Date(expiresAt), new Date()]);
  }

  async getUserBySession(tokenHash: string) {
    const [rows] = await this.pool.execute(`SELECT u.* FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`, [tokenHash, new Date()]);
    const row = (rows as DbRow[])[0];
    return row ? toUser(row) : null;
  }

  async deleteSession(tokenHash: string) {
    await this.pool.execute("DELETE FROM user_sessions WHERE token_hash=?", [tokenHash]);
  }

  async deleteUserSessions(userId: string) {
    await this.pool.execute("DELETE FROM user_sessions WHERE user_id=?", [userId]);
  }

  async consumeAuthAttempt(key: string, limit: number, windowSeconds: number) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute("SELECT * FROM auth_rate_limits WHERE bucket_key=? FOR UPDATE", [key]);
      const current = (rows as DbRow[])[0];
      const stamp = new Date();
      const expired = !current || stamp.getTime() - new Date(current.window_started_at).getTime() >= windowSeconds * 1000;
      const count = expired ? 1 : Number(current.attempt_count) + 1;
      const windowStartedAt = expired ? stamp : new Date(current.window_started_at);
      await connection.execute(`INSERT INTO auth_rate_limits (bucket_key,window_started_at,attempt_count) VALUES (?,?,?) ON DUPLICATE KEY UPDATE window_started_at=VALUES(window_started_at),attempt_count=VALUES(attempt_count)`, [key, windowStartedAt, count]);
      await connection.commit();
      return { allowed: count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((windowStartedAt.getTime() + windowSeconds * 1000 - stamp.getTime()) / 1000)) };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async resetAuthAttempt(key: string) {
    await this.pool.execute("DELETE FROM auth_rate_limits WHERE bucket_key=?", [key]);
  }

  async claimUnownedProjects(userId: string) {
    const [result] = await this.pool.execute("UPDATE projects SET user_id=? WHERE user_id IS NULL", [userId]);
    return Number((result as { affectedRows?: number }).affectedRows ?? 0);
  }

  async listCanvases(userId: string) {
    const [rows] = await this.pool.execute("SELECT * FROM canvas_projects WHERE user_id=? ORDER BY updated_at DESC", [userId]);
    return (rows as DbRow[]).map(toCanvas);
  }

  async getCanvas(userId: string, id: string) {
    const [rows] = await this.pool.execute("SELECT * FROM canvas_projects WHERE id=? AND user_id=?", [id, userId]);
    const row = (rows as DbRow[])[0];
    return row ? toCanvas(row) : null;
  }

  async createCanvas(userId: string, input: CreateCanvasInput) {
    if (input.sourceId) {
      const [existingRows] = await this.pool.execute("SELECT * FROM canvas_projects WHERE user_id=? AND source_id=?", [userId, input.sourceId]);
      const existing = (existingRows as DbRow[])[0];
      if (existing) return toCanvas(existing);
    }
    const id = randomUUID();
    const stamp = new Date();
    await this.pool.execute(`INSERT INTO canvas_projects (id,user_id,name,nodes_json,edges_json,node_count,version,source_id,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?,?)`, [id, userId, input.name, input.nodesJson, input.edgesJson, input.nodeCount, input.sourceId ?? null, stamp, stamp]);
    return (await this.getCanvas(userId, id))!;
  }

  async updateCanvas(userId: string, id: string, input: UpdateCanvasInput) {
    const current = await this.getCanvas(userId, id);
    if (!current) return null;
    const next = { ...current, ...input };
    await this.pool.execute(`UPDATE canvas_projects SET name=?,nodes_json=?,edges_json=?,node_count=?,version=version+1,updated_at=? WHERE id=? AND user_id=?`, [next.name, next.nodesJson, next.edgesJson, next.nodeCount, new Date(), id, userId]);
    return this.getCanvas(userId, id);
  }

  async deleteCanvas(userId: string, id: string) {
    const [result] = await this.pool.execute("DELETE FROM canvas_projects WHERE id=? AND user_id=?", [id, userId]);
    return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
  }

  async listProjects(userId: string) {
    const [rows] = await this.pool.execute("SELECT * FROM projects WHERE user_id=? ORDER BY updated_at DESC", [userId]);
    return (rows as DbRow[]).map(toProject);
  }

  async getProject(id: string, userId?: string) {
    const [rows] = await this.pool.execute(`SELECT * FROM projects WHERE id=?${userId ? " AND user_id=?" : ""}`, userId ? [id, userId] : [id]);
    const row = (rows as DbRow[])[0];
    return row ? toProject(row) : null;
  }

  async createProject(userId: string, input: CreateProjectInput) {
    const id = randomUUID();
    const stamp = new Date();
    await this.pool.execute(`INSERT INTO projects
      (id,user_id,title,logline,genre,style,aspect_ratio,duration_seconds,target_episode_count,status,progress,cover_url,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'draft',8,NULL,?,?)`,
    [id, userId, input.title, input.logline, input.genre, input.style, input.aspectRatio, input.durationSeconds, input.targetEpisodeCount, stamp, stamp]);
    return (await this.getProject(id, userId))!;
  }

  async deleteProject(id: string, userId: string) {
    const [result] = await this.pool.execute("DELETE FROM projects WHERE id=? AND user_id=?", [id, userId]);
    return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
  }

  async updateProject(id: string, input: UpdateProjectInput, userId?: string) {
    const current = await this.getProject(id, userId);
    if (!current) return null;
    const next = { ...current, ...input };
    await this.pool.execute(`UPDATE projects SET title=?,logline=?,genre=?,style=?,aspect_ratio=?,duration_seconds=?,target_episode_count=?,status=?,progress=?,cover_url=?,updated_at=? WHERE id=?${userId ? " AND user_id=?" : ""}`,
      [next.title, next.logline, next.genre, next.style, next.aspectRatio, next.durationSeconds, next.targetEpisodeCount ?? 3, next.status, next.progress, next.coverUrl, new Date(), id, ...(userId ? [userId] : [])]);
    return this.getProject(id, userId);
  }

  async listScenes(projectId: string) {
    const [rows] = await this.pool.execute("SELECT * FROM scenes WHERE project_id = ? ORDER BY scene_order", [projectId]);
    return (rows as DbRow[]).map(toScene);
  }

  async replaceScenes(projectId: string, scenes: Omit<Scene, "id" | "projectId" | "createdAt" | "updatedAt">[]) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute("DELETE FROM scenes WHERE project_id = ?", [projectId]);
      for (const scene of scenes) {
        const stamp = new Date();
        await connection.execute(`INSERT INTO scenes
          (id,project_id,scene_order,title,narration,visual_prompt,duration_seconds,camera,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [randomUUID(), projectId, scene.sceneOrder, scene.title, scene.narration, scene.visualPrompt, scene.durationSeconds, scene.camera, stamp, stamp]);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return this.listScenes(projectId);
  }

  async listJobs(userId?: string) {
    const [rows] = await this.pool.execute(`SELECT j.*, p.title AS project_title FROM render_jobs j JOIN projects p ON p.id=j.project_id ${userId ? "WHERE p.user_id=?" : ""} ORDER BY j.created_at DESC`, userId ? [userId] : []);
    return (rows as DbRow[]).map(toJob);
  }

  async createRenderJob(projectId: string, shotId?: string, provider = "mock-video", providerTaskId?: string, status = "queued" as RenderJob["status"], progress = 3) {
    const id = randomUUID();
    const stamp = new Date();
    await this.pool.execute(`INSERT INTO render_jobs
      (id,project_id,shot_id,provider,provider_task_id,status,progress,output_url,error_message,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    [id, projectId, shotId ?? null, provider, providerTaskId ?? null, status, progress, stamp, stamp]);
    const [rows] = await this.pool.execute(`SELECT j.*, p.title AS project_title FROM render_jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=?`, [id]);
    return toJob((rows as DbRow[])[0]);
  }

  async setRenderJobPrompt(id: string, generationPrompt: string) {
    const stamp = new Date();
    await this.pool.execute("UPDATE render_jobs SET generation_prompt=?,updated_at=? WHERE id=?", [generationPrompt, stamp, id]);
    const [rows] = await this.pool.execute("SELECT j.*, p.title AS project_title FROM render_jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=?", [id]);
    const row = (rows as DbRow[])[0];
    return row ? toJob(row) : null;
  }

  async startRenderJob(id: string, providerTaskId: string, status: RenderJob["status"], progress: number) {
    const stamp = new Date();
    await this.pool.execute("UPDATE render_jobs SET provider_task_id=?,status=?,progress=?,error_message=NULL,updated_at=? WHERE id=?", [providerTaskId, status, progress, stamp, id]);
    const [rows] = await this.pool.execute(`SELECT j.*, p.title AS project_title FROM render_jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=?`, [id]);
    const row = (rows as DbRow[])[0];
    return row ? toJob(row) : null;
  }

  async updateRenderJob(id: string, input: { status: RenderJob["status"]; progress: number; outputUrl?: string | null; errorMessage?: string | null }) {
    const stamp = new Date();
    await this.pool.execute(`UPDATE render_jobs SET status=?, progress=?, output_url=?, error_message=?, updated_at=? WHERE id=?`, [input.status, input.progress, input.outputUrl ?? null, input.errorMessage ?? null, stamp, id]);
    const [rows] = await this.pool.execute(`SELECT j.*, p.title AS project_title FROM render_jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=?`, [id]);
    const row = (rows as DbRow[])[0];
    return row ? toJob(row) : null;
  }

  async getScriptDocument(projectId: string) {
    const [rows] = await this.pool.execute("SELECT * FROM script_documents WHERE project_id=?", [projectId]);
    const row = (rows as DbRow[])[0];
    return row ? toDocument(row) : null;
  }

  async saveScriptDocument(projectId: string, originalText: string, formattedText: string, formatStatus: "raw" | "formatted" = "formatted") {
    const existing = await this.getScriptDocument(projectId);
    const id = existing?.id ?? randomUUID(); const stamp = new Date();
    await this.pool.execute(`INSERT INTO script_documents (id,project_id,original_text,formatted_text,format_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE original_text=VALUES(original_text),formatted_text=VALUES(formatted_text),format_status=VALUES(format_status),updated_at=VALUES(updated_at)`, [id, projectId, originalText, formattedText, formatStatus, existing ? new Date(existing.createdAt) : stamp, stamp]);
    return (await this.getScriptDocument(projectId))!;
  }

  async listEpisodes(projectId: string) {
    const [rows] = await this.pool.execute(`SELECT e.*, COUNT(s.id) AS scene_count FROM episodes e LEFT JOIN shots s ON s.episode_id=e.id WHERE e.project_id=? GROUP BY e.id ORDER BY e.episode_number`, [projectId]);
    return (rows as DbRow[]).map(toEpisode);
  }

  async replaceEpisodes(projectId: string, episodes: Omit<Episode, "id" | "projectId" | "sceneCount" | "createdAt" | "updatedAt">[]) {
    const connection = await this.pool.getConnection();
    try { await connection.beginTransaction(); await connection.execute("DELETE FROM episodes WHERE project_id=?", [projectId]); for (const episode of episodes) { const stamp = new Date(); await connection.execute("INSERT INTO episodes (id,project_id,episode_number,title,summary,hook,original_text,plot_nodes,characters,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [randomUUID(),projectId,episode.episodeNumber,episode.title,episode.summary,episode.hook,episode.originalText,JSON.stringify(episode.plotNodes),JSON.stringify(episode.characters),episode.status,stamp,stamp]); } await connection.commit(); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    return this.listEpisodes(projectId);
  }

  async listSubjects(projectId: string) {
    const [rows] = await this.pool.execute("SELECT * FROM subjects WHERE project_id=? ORDER BY role,name", [projectId]); return (rows as DbRow[]).map(toSubject);
  }

  async replaceSubjects(projectId: string, subjects: Omit<Subject, "id" | "projectId" | "imageUrl" | "createdAt" | "updatedAt">[]) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute("SELECT id,name,role FROM subjects WHERE project_id=? FOR UPDATE", [projectId]);
      const existing = rows as DbRow[];
      const existingByKey = new Map(existing.map((row) => [`${row.role}:${row.name}`, row]));
      const retainedIds = new Set<string>();
      for (const subject of subjects) {
        const existingRow = existingByKey.get(`${subject.role}:${subject.name}`);
        const stamp = new Date();
        if (existingRow) {
          retainedIds.add(String(existingRow.id));
          await connection.execute("UPDATE subjects SET description=?,visual_prompt=?,updated_at=? WHERE id=? AND project_id=?", [subject.description, subject.visualPrompt, stamp, existingRow.id, projectId]);
        } else {
          const id = randomUUID();
          retainedIds.add(id);
          await connection.execute("INSERT INTO subjects (id,project_id,name,role,description,visual_prompt,image_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", [id, projectId, subject.name, subject.role, subject.description, subject.visualPrompt, null, stamp, stamp]);
        }
      }
      for (const row of existing) if (!retainedIds.has(String(row.id))) await connection.execute("DELETE FROM subjects WHERE id=? AND project_id=?", [row.id, projectId]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
    return this.listSubjects(projectId);
  }

  async deleteSubject(projectId: string, subjectId: string) {
    const [result] = await this.pool.execute("DELETE FROM subjects WHERE id=? AND project_id=?", [subjectId, projectId]);
    return Number((result as { affectedRows?: number }).affectedRows ?? 0) > 0;
  }

  async updateSubjectImage(projectId: string, subjectId: string, imageUrl: string) {
    const [result] = await this.pool.execute("UPDATE subjects SET image_url=?,updated_at=? WHERE id=? AND project_id=?", [imageUrl, new Date(), subjectId, projectId]);
    if (!Number((result as { affectedRows?: number }).affectedRows ?? 0)) return null;
    const [rows] = await this.pool.execute("SELECT * FROM subjects WHERE id=? AND project_id=?", [subjectId, projectId]);
    return toSubject((rows as DbRow[])[0]);
  }

  async listShots(projectId: string, episodeNumber?: number) {
    const [rows] = await this.pool.execute(`SELECT * FROM shots WHERE project_id=? ${episodeNumber ? "AND episode_number=?" : ""} ORDER BY episode_number,shot_order`, episodeNumber ? [projectId,episodeNumber] : [projectId]); return (rows as DbRow[]).map(toShot);
  }

  async updateShot(projectId: string, shotId: string, input: Pick<Shot, "location" | "action" | "visualPrompt">) {
    const [result] = await this.pool.execute("UPDATE shots SET location=?, action=?, visual_prompt=?, updated_at=? WHERE id=? AND project_id=?", [input.location, input.action, input.visualPrompt, new Date(), shotId, projectId]);
    if (!Number((result as { affectedRows?: number }).affectedRows ?? 0)) return null;
    const [rows] = await this.pool.execute("SELECT * FROM shots WHERE id=? AND project_id=?", [shotId, projectId]);
    const row = (rows as DbRow[])[0];
    return row ? toShot(row) : null;
  }

  async deleteShot(projectId: string, shotId: string) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute("SELECT episode_number FROM shots WHERE id=? AND project_id=? FOR UPDATE", [shotId, projectId]);
      const row = (rows as DbRow[])[0];
      if (!row) { await connection.rollback(); return false; }
      const episodeNumber = Number(row.episode_number);
      await connection.execute("DELETE FROM render_jobs WHERE project_id=? AND shot_id=?", [projectId, shotId]);
      await connection.execute("DELETE FROM shots WHERE id=? AND project_id=?", [shotId, projectId]);
      await connection.execute("UPDATE shots SET shot_order=shot_order+1000000 WHERE project_id=? AND episode_number=?", [projectId, episodeNumber]);
      const [remainingRows] = await connection.execute("SELECT id FROM shots WHERE project_id=? AND episode_number=? ORDER BY shot_order", [projectId, episodeNumber]);
      for (const [index, shot] of (remainingRows as DbRow[]).entries()) {
        await connection.execute("UPDATE shots SET shot_order=?, updated_at=? WHERE id=? AND project_id=?", [index + 1, new Date(), shot.id, projectId]);
      }
      await connection.commit();
      return true;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  async deleteShots(projectId: string) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute("DELETE FROM render_jobs WHERE project_id=? AND shot_id IS NOT NULL", [projectId]);
      const [result] = await connection.execute("DELETE FROM shots WHERE project_id=?", [projectId]);
      await connection.commit();
      return Number((result as { affectedRows?: number }).affectedRows ?? 0);
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }

  async replaceShots(projectId: string, shots: Omit<Shot, "id" | "projectId" | "createdAt" | "updatedAt">[]) {
    await this.pool.execute("DELETE FROM shots WHERE project_id=?", [projectId]); for (const shot of shots) { const stamp = new Date(); await this.pool.execute("INSERT INTO shots (id,project_id,episode_id,episode_number,shot_order,title,location,action,dialogue,visual_prompt,camera,duration_seconds,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [randomUUID(),projectId,shot.episodeId,shot.episodeNumber,shot.shotOrder,shot.title,shot.location,shot.action,shot.dialogue,shot.visualPrompt,shot.camera,shot.durationSeconds,shot.status,stamp,stamp]); } return this.listShots(projectId);
  }

  async replaceEpisodeShots(projectId: string, episodeId: string, shots: Omit<Shot, "id" | "projectId" | "createdAt" | "updatedAt">[]) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute("DELETE FROM shots WHERE project_id=? AND episode_id=?", [projectId, episodeId]);
      for (const shot of shots) {
        const stamp = new Date();
        await connection.execute("INSERT INTO shots (id,project_id,episode_id,episode_number,shot_order,title,location,action,dialogue,visual_prompt,camera,duration_seconds,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [randomUUID(),projectId,shot.episodeId,shot.episodeNumber,shot.shotOrder,shot.title,shot.location,shot.action,shot.dialogue,shot.visualPrompt,shot.camera,shot.durationSeconds,shot.status,stamp,stamp]);
      }
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
    return this.listShots(projectId, shots[0]?.episodeNumber);
  }
}

export function createDatabaseStore(databaseUrl: string): DatabaseStore {
  return databaseUrl.startsWith("mysql://") ? new MysqlStore(databaseUrl) : new SqliteStore(databaseUrl);
}
