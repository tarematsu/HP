PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_url TEXT NOT NULL UNIQUE,
  canonical_key TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL DEFAULT 'video',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_checked_at TEXT,
  last_http_status INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dead', 'hidden'))
);

CREATE TABLE IF NOT EXISTS ranking_entries (
  period TEXT NOT NULL CHECK (period IN ('24h', '3d', '7d')),
  video_id INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY (period, video_id),
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ranking_period_rank
  ON ranking_entries(period, rank);
CREATE INDEX IF NOT EXISTS idx_videos_status_last_seen
  ON videos(status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_health_queue
  ON videos(status, last_checked_at);

CREATE TABLE IF NOT EXISTS collection_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  source_method TEXT,
  source_url TEXT NOT NULL,
  found_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_collection_runs_started
  ON collection_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER,
  media_url TEXT,
  reason TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  client_hash TEXT,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_created
  ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_rate_limit
  ON reports(client_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS worker_locks (
  name TEXT PRIMARY KEY,
  acquired_at TEXT NOT NULL
);
