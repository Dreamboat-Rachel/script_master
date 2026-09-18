CREATE DATABASE IF NOT EXISTS script_master
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE script_master;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  account VARCHAR(80) NOT NULL,
  password_hash VARCHAR(128) NOT NULL,
  password_salt VARCHAR(128) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'user',
  display_name VARCHAR(80) NOT NULL DEFAULT '',
  email VARCHAR(254) NOT NULL DEFAULT '',
  avatar_url VARCHAR(2000) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_account (account)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket_key CHAR(64) PRIMARY KEY,
  window_started_at DATETIME(3) NOT NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_sessions_expires_at (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS canvas_projects (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  nodes_json LONGTEXT NOT NULL,
  edges_json LONGTEXT NOT NULL,
  node_count INT UNSIGNED NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  source_id VARCHAR(100) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_canvas_projects_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_canvas_source (user_id, source_id),
  INDEX idx_canvas_user_updated (user_id, updated_at DESC)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS projects (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NULL,
  title VARCHAR(120) NOT NULL,
  logline VARCHAR(5000) NOT NULL DEFAULT '',
  genre VARCHAR(40) NOT NULL,
  style VARCHAR(40) NOT NULL,
  aspect_ratio VARCHAR(10) NOT NULL DEFAULT '16:9',
  duration_seconds INT UNSIGNED NOT NULL DEFAULT 60,
  target_episode_count INT UNSIGNED NOT NULL DEFAULT 3,
  status ENUM('draft', 'scripting', 'storyboarding', 'rendering', 'completed', 'failed') NOT NULL DEFAULT 'draft',
  progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
  cover_url VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_projects_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_projects_user_updated (user_id, updated_at DESC),
  INDEX idx_projects_updated_at (updated_at DESC),
  INDEX idx_projects_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS scenes (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  scene_order INT UNSIGNED NOT NULL,
  title VARCHAR(120) NOT NULL,
  narration TEXT NOT NULL,
  visual_prompt TEXT NOT NULL,
  duration_seconds INT UNSIGNED NOT NULL DEFAULT 6,
  camera VARCHAR(80) NOT NULL DEFAULT '中景',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_scenes_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE KEY uq_scene_order (project_id, scene_order)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS render_jobs (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  shot_id CHAR(36) NULL,
  provider VARCHAR(40) NOT NULL DEFAULT 'mock',
  status ENUM('queued', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'queued',
  progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
  output_url VARCHAR(1000) NULL,
  error_message TEXT NULL,
  generation_prompt LONGTEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_render_jobs_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  INDEX idx_jobs_status (status),
  INDEX idx_jobs_project (project_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS script_documents (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL UNIQUE,
  original_text LONGTEXT NOT NULL,
  formatted_text LONGTEXT NOT NULL,
  format_status VARCHAR(20) NOT NULL DEFAULT 'raw',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_documents_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS episodes (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  episode_number INT UNSIGNED NOT NULL,
  title VARCHAR(120) NOT NULL,
  summary TEXT NOT NULL,
  hook TEXT NOT NULL,
  original_text LONGTEXT NOT NULL,
  plot_nodes JSON NOT NULL,
  characters JSON NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_episodes_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE KEY uq_episode_number (project_id, episode_number)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS subjects (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  role VARCHAR(20) NOT NULL,
  description TEXT NOT NULL,
  visual_prompt TEXT NOT NULL,
  image_url VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_subjects_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  INDEX idx_subjects_project (project_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS shots (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  episode_id CHAR(36) NOT NULL,
  episode_number INT UNSIGNED NOT NULL,
  shot_order INT UNSIGNED NOT NULL,
  title VARCHAR(120) NOT NULL,
  location VARCHAR(160) NOT NULL,
  action TEXT NOT NULL,
  dialogue TEXT NOT NULL,
  visual_prompt TEXT NOT NULL,
  camera VARCHAR(80) NOT NULL,
  duration_seconds INT UNSIGNED NOT NULL DEFAULT 6,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_shots_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_shots_episode FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
  UNIQUE KEY uq_shot_order (project_id, episode_number, shot_order)
) ENGINE=InnoDB;
