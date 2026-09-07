CREATE DATABASE IF NOT EXISTS script_master
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE script_master;

CREATE TABLE IF NOT EXISTS projects (
  id CHAR(36) PRIMARY KEY,
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
  provider VARCHAR(40) NOT NULL DEFAULT 'mock',
  status ENUM('queued', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'queued',
  progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
  output_url VARCHAR(1000) NULL,
  error_message TEXT NULL,
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
