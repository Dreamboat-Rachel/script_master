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
}

export interface DatabaseStore {
  initialize(): Promise<void>;
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  createProject(input: CreateProjectInput): Promise<Project>;
  updateProject(id: string, input: Partial<CreateProjectInput> & { status?: ProjectStatus; progress?: number }): Promise<Project | null>;
  listScenes(projectId: string): Promise<Scene[]>;
  replaceScenes(projectId: string, scenes: Omit<Scene, "id" | "projectId" | "createdAt" | "updatedAt">[]): Promise<Scene[]>;
  listJobs(): Promise<RenderJob[]>;
  createRenderJob(projectId: string): Promise<RenderJob>;
  getScriptDocument(projectId: string): Promise<ScriptDocument | null>;
  saveScriptDocument(projectId: string, originalText: string, formattedText: string): Promise<ScriptDocument>;
  listEpisodes(projectId: string): Promise<Episode[]>;
  replaceEpisodes(projectId: string, episodes: Omit<Episode, "id" | "projectId" | "sceneCount" | "createdAt" | "updatedAt">[]): Promise<Episode[]>;
  listSubjects(projectId: string): Promise<Subject[]>;
  replaceSubjects(projectId: string, subjects: Omit<Subject, "id" | "projectId" | "createdAt" | "updatedAt">[]): Promise<Subject[]>;
  listShots(projectId: string, episodeNumber?: number): Promise<Shot[]>;
  replaceShots(projectId: string, shots: Omit<Shot, "id" | "projectId" | "createdAt" | "updatedAt">[]): Promise<Shot[]>;
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
    projectTitle: row.project_title,
    provider: row.provider,
    status: row.status,
    progress: Number(row.progress),
    outputUrl: row.output_url ?? null,
    errorMessage: row.error_message ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function toDocument(row: DbRow): ScriptDocument {
  return { id: row.id, projectId: row.project_id, originalText: row.original_text, formattedText: row.formatted_text, formatStatus: row.format_status, createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at, updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at };
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
  return { id: row.id, projectId: row.project_id, name: row.name, role: row.role, description: row.description, visualPrompt: row.visual_prompt, createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at, updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at };
}

function toShot(row: DbRow): Shot {
  return { id: row.id, projectId: row.project_id, episodeId: row.episode_id, episodeNumber: Number(row.episode_number), shotOrder: Number(row.shot_order), title: row.title, location: row.location, action: row.action, dialogue: row.dialogue, visualPrompt: row.visual_prompt, camera: row.camera, durationSeconds: Number(row.duration_seconds), status: row.status, createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at, updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at };
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
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  }

  async initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        logline TEXT NOT NULL DEFAULT '',
        genre TEXT NOT NULL,
        style TEXT NOT NULL,
        aspect_ratio TEXT NOT NULL DEFAULT '16:9',
        duration_seconds INTEGER NOT NULL DEFAULT 60,
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
        provider TEXT NOT NULL DEFAULT 'mock',
        status TEXT NOT NULL DEFAULT 'queued',
        progress INTEGER NOT NULL DEFAULT 0,
        output_url TEXT,
        error_message TEXT,
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
        visual_prompt TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
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
    `);

    for (const statement of [
      "ALTER TABLE episodes ADD COLUMN hook TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE episodes ADD COLUMN original_text TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE episodes ADD COLUMN plot_nodes TEXT NOT NULL DEFAULT '[]'",
      "ALTER TABLE episodes ADD COLUMN characters TEXT NOT NULL DEFAULT '[]'",
    ]) { try { this.db.exec(statement); } catch { /* Existing installations already have this column. */ } }

    const count = this.db.prepare("SELECT COUNT(*) AS total FROM projects").get() as { total: number };
    if (count.total > 0) return;

    const insertProject = this.db.prepare(`
      INSERT INTO projects (id, title, logline, genre, style, aspect_ratio, duration_seconds, status, progress, cover_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        insertProject.run(project.id, project.title, project.logline, project.genre, project.style, project.aspectRatio, project.durationSeconds, project.status, project.progress, project.coverUrl, stamp, stamp);
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

  async listProjects() {
    return (this.db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as DbRow[]).map(toProject);
  }

  async getProject(id: string) {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as DbRow | undefined;
    return row ? toProject(row) : null;
  }

  async createProject(input: CreateProjectInput) {
    const id = randomUUID();
    const stamp = now();
    this.db.prepare(`
      INSERT INTO projects (id, title, logline, genre, style, aspect_ratio, duration_seconds, status, progress, cover_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 8, NULL, ?, ?)
    `).run(id, input.title, input.logline, input.genre, input.style, input.aspectRatio, input.durationSeconds, stamp, stamp);
    return (await this.getProject(id))!;
  }

  async updateProject(id: string, input: Partial<CreateProjectInput> & { status?: ProjectStatus; progress?: number }) {
    const current = await this.getProject(id);
    if (!current) return null;
    const next = { ...current, ...input, updatedAt: now() };
    this.db.prepare(`
      UPDATE projects SET title=?, logline=?, genre=?, style=?, aspect_ratio=?, duration_seconds=?, status=?, progress=?, updated_at=? WHERE id=?
    `).run(next.title, next.logline, next.genre, next.style, next.aspectRatio, next.durationSeconds, next.status, next.progress, next.updatedAt, id);
    return this.getProject(id);
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

  async listJobs() {
    return (this.db.prepare(`
      SELECT j.*, p.title AS project_title FROM render_jobs j
      JOIN projects p ON p.id = j.project_id ORDER BY j.created_at DESC
    `).all() as DbRow[]).map(toJob);
  }

  async createRenderJob(projectId: string) {
    const id = randomUUID();
    const stamp = now();
    this.db.prepare(`
      INSERT INTO render_jobs (id, project_id, provider, status, progress, output_url, error_message, created_at, updated_at)
      VALUES (?, ?, 'mock-video', 'queued', 3, NULL, NULL, ?, ?)
    `).run(id, projectId, stamp, stamp);
    const row = this.db.prepare(`
      SELECT j.*, p.title AS project_title FROM render_jobs j JOIN projects p ON p.id = j.project_id WHERE j.id = ?
    `).get(id) as DbRow;
    return toJob(row);
  }

  async getScriptDocument(projectId: string) {
    const row = this.db.prepare("SELECT * FROM script_documents WHERE project_id = ?").get(projectId) as DbRow | undefined;
    return row ? toDocument(row) : null;
  }

  async saveScriptDocument(projectId: string, originalText: string, formattedText: string) {
    const existing = await this.getScriptDocument(projectId);
    const id = existing?.id ?? randomUUID();
    const stamp = now();
    this.db.prepare(`INSERT INTO script_documents (id,project_id,original_text,formatted_text,format_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET original_text=excluded.original_text,formatted_text=excluded.formatted_text,format_status=excluded.format_status,updated_at=excluded.updated_at`)
      .run(id, projectId, originalText, formattedText, "formatted", existing?.createdAt ?? stamp, stamp);
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

  async replaceSubjects(projectId: string, subjects: Omit<Subject, "id" | "projectId" | "createdAt" | "updatedAt">[]) {
    this.db.prepare("DELETE FROM subjects WHERE project_id=?").run(projectId);
    const insert = this.db.prepare(`INSERT INTO subjects (id,project_id,name,role,description,visual_prompt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`);
    for (const subject of subjects) { const stamp = now(); insert.run(randomUUID(), projectId, subject.name, subject.role, subject.description, subject.visualPrompt, stamp, stamp); }
    return this.listSubjects(projectId);
  }

  async listShots(projectId: string, episodeNumber?: number) {
    const rows = this.db.prepare(`SELECT * FROM shots WHERE project_id=? ${episodeNumber ? "AND episode_number=?" : ""} ORDER BY episode_number,shot_order`).all(...(episodeNumber ? [projectId, episodeNumber] : [projectId])) as DbRow[];
    return rows.map(toShot);
  }

  async replaceShots(projectId: string, shots: Omit<Shot, "id" | "projectId" | "createdAt" | "updatedAt">[]) {
    this.db.prepare("DELETE FROM shots WHERE project_id=?").run(projectId);
    const insert = this.db.prepare(`INSERT INTO shots (id,project_id,episode_id,episode_number,shot_order,title,location,action,dialogue,visual_prompt,camera,duration_seconds,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const shot of shots) { const stamp = now(); insert.run(randomUUID(), projectId, shot.episodeId, shot.episodeNumber, shot.shotOrder, shot.title, shot.location, shot.action, shot.dialogue, shot.visualPrompt, shot.camera, shot.durationSeconds, shot.status, stamp, stamp); }
    return this.listShots(projectId);
  }
}

class MysqlStore implements DatabaseStore {
  private pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 8, charset: "utf8mb4" });
  }

  async initialize() {
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS projects (
      id CHAR(36) PRIMARY KEY, title VARCHAR(120) NOT NULL, logline VARCHAR(500) NOT NULL DEFAULT '',
      genre VARCHAR(40) NOT NULL, style VARCHAR(40) NOT NULL, aspect_ratio VARCHAR(10) NOT NULL DEFAULT '16:9',
      duration_seconds INT UNSIGNED NOT NULL DEFAULT 60, status VARCHAR(24) NOT NULL DEFAULT 'draft',
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
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, provider VARCHAR(40) NOT NULL DEFAULT 'mock',
      status VARCHAR(24) NOT NULL DEFAULT 'queued', progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
      output_url VARCHAR(1000) NULL, error_message TEXT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
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
      "ALTER TABLE episodes ADD COLUMN hook TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE episodes ADD COLUMN original_text LONGTEXT NOT NULL",
      "ALTER TABLE episodes ADD COLUMN plot_nodes JSON NOT NULL",
      "ALTER TABLE episodes ADD COLUMN characters JSON NOT NULL",
    ]) { try { await this.pool.execute(statement); } catch { /* Existing installations already have this column. */ } }
    await this.pool.execute(`CREATE TABLE IF NOT EXISTS subjects (
      id CHAR(36) PRIMARY KEY, project_id CHAR(36) NOT NULL, name VARCHAR(120) NOT NULL, role VARCHAR(20) NOT NULL,
      description TEXT NOT NULL, visual_prompt TEXT NOT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
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
        (id,title,logline,genre,style,aspect_ratio,duration_seconds,status,progress,cover_url,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [project.id, project.title, project.logline, project.genre, project.style, project.aspectRatio, project.durationSeconds, project.status, project.progress, project.coverUrl, stamp, stamp]);
    }
    for (const scene of seedScenes(projectSeeds[0].id)) {
      await this.pool.execute(`INSERT INTO scenes
        (id,project_id,scene_order,title,narration,visual_prompt,duration_seconds,camera,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, scene);
    }
    const stamp = new Date();
    await this.pool.execute(`INSERT INTO render_jobs
      (id,project_id,provider,status,progress,output_url,error_message,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    [randomUUID(), projectSeeds[2].id, "mock-video", "processing", 36, null, null, stamp, stamp]);
  }

  async listProjects() {
    const [rows] = await this.pool.query("SELECT * FROM projects ORDER BY updated_at DESC");
    return (rows as DbRow[]).map(toProject);
  }

  async getProject(id: string) {
    const [rows] = await this.pool.execute("SELECT * FROM projects WHERE id = ?", [id]);
    const row = (rows as DbRow[])[0];
    return row ? toProject(row) : null;
  }

  async createProject(input: CreateProjectInput) {
    const id = randomUUID();
    const stamp = new Date();
    await this.pool.execute(`INSERT INTO projects
      (id,title,logline,genre,style,aspect_ratio,duration_seconds,status,progress,cover_url,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'draft',8,NULL,?,?)`,
    [id, input.title, input.logline, input.genre, input.style, input.aspectRatio, input.durationSeconds, stamp, stamp]);
    return (await this.getProject(id))!;
  }

  async updateProject(id: string, input: Partial<CreateProjectInput> & { status?: ProjectStatus; progress?: number }) {
    const current = await this.getProject(id);
    if (!current) return null;
    const next = { ...current, ...input };
    await this.pool.execute(`UPDATE projects SET title=?,logline=?,genre=?,style=?,aspect_ratio=?,duration_seconds=?,status=?,progress=?,updated_at=? WHERE id=?`,
      [next.title, next.logline, next.genre, next.style, next.aspectRatio, next.durationSeconds, next.status, next.progress, new Date(), id]);
    return this.getProject(id);
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

  async listJobs() {
    const [rows] = await this.pool.query(`SELECT j.*, p.title AS project_title FROM render_jobs j JOIN projects p ON p.id=j.project_id ORDER BY j.created_at DESC`);
    return (rows as DbRow[]).map(toJob);
  }

  async createRenderJob(projectId: string) {
    const id = randomUUID();
    const stamp = new Date();
    await this.pool.execute(`INSERT INTO render_jobs
      (id,project_id,provider,status,progress,output_url,error_message,created_at,updated_at) VALUES (?,?,'mock-video','queued',3,NULL,NULL,?,?)`,
    [id, projectId, stamp, stamp]);
    const [rows] = await this.pool.execute(`SELECT j.*, p.title AS project_title FROM render_jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=?`, [id]);
    return toJob((rows as DbRow[])[0]);
  }

  async getScriptDocument(projectId: string) {
    const [rows] = await this.pool.execute("SELECT * FROM script_documents WHERE project_id=?", [projectId]);
    const row = (rows as DbRow[])[0];
    return row ? toDocument(row) : null;
  }

  async saveScriptDocument(projectId: string, originalText: string, formattedText: string) {
    const existing = await this.getScriptDocument(projectId);
    const id = existing?.id ?? randomUUID(); const stamp = new Date();
    await this.pool.execute(`INSERT INTO script_documents (id,project_id,original_text,formatted_text,format_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE original_text=VALUES(original_text),formatted_text=VALUES(formatted_text),format_status=VALUES(format_status),updated_at=VALUES(updated_at)`, [id, projectId, originalText, formattedText, "formatted", existing ? new Date(existing.createdAt) : stamp, stamp]);
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

  async replaceSubjects(projectId: string, subjects: Omit<Subject, "id" | "projectId" | "createdAt" | "updatedAt">[]) {
    await this.pool.execute("DELETE FROM subjects WHERE project_id=?", [projectId]); for (const subject of subjects) { const stamp = new Date(); await this.pool.execute("INSERT INTO subjects (id,project_id,name,role,description,visual_prompt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", [randomUUID(),projectId,subject.name,subject.role,subject.description,subject.visualPrompt,stamp,stamp]); } return this.listSubjects(projectId);
  }

  async listShots(projectId: string, episodeNumber?: number) {
    const [rows] = await this.pool.execute(`SELECT * FROM shots WHERE project_id=? ${episodeNumber ? "AND episode_number=?" : ""} ORDER BY episode_number,shot_order`, episodeNumber ? [projectId,episodeNumber] : [projectId]); return (rows as DbRow[]).map(toShot);
  }

  async replaceShots(projectId: string, shots: Omit<Shot, "id" | "projectId" | "createdAt" | "updatedAt">[]) {
    await this.pool.execute("DELETE FROM shots WHERE project_id=?", [projectId]); for (const shot of shots) { const stamp = new Date(); await this.pool.execute("INSERT INTO shots (id,project_id,episode_id,episode_number,shot_order,title,location,action,dialogue,visual_prompt,camera,duration_seconds,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [randomUUID(),projectId,shot.episodeId,shot.episodeNumber,shot.shotOrder,shot.title,shot.location,shot.action,shot.dialogue,shot.visualPrompt,shot.camera,shot.durationSeconds,shot.status,stamp,stamp]); } return this.listShots(projectId);
  }
}

export function createDatabaseStore(databaseUrl: string): DatabaseStore {
  return databaseUrl.startsWith("mysql://") ? new MysqlStore(databaseUrl) : new SqliteStore(databaseUrl);
}
