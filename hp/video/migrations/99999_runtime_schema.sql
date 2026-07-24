PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS d1_maintenance_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_cleanup_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO d1_maintenance_state (id, last_cleanup_at) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS playback_feed_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content_hash TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
INSERT OR IGNORE INTO playback_feed_state (id) VALUES (1);

CREATE TABLE IF NOT EXISTS collection_run_timings (
  run_id INTEGER PRIMARY KEY,
  collection_duration_ms INTEGER NOT NULL DEFAULT 0,
  database_duration_ms INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (run_id) REFERENCES collection_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS video_blocklist (
  canonical_key TEXT PRIMARY KEY,
  media_url TEXT NOT NULL,
  video_id INTEGER,
  blocked_at TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'bad-button'
);
CREATE INDEX IF NOT EXISTS idx_video_blocklist_blocked_at
  ON video_blocklist(blocked_at DESC, canonical_key);

CREATE TABLE IF NOT EXISTS video_death_list (
  canonical_key TEXT PRIMARY KEY,
  media_url TEXT NOT NULL,
  video_id INTEGER,
  detected_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  last_http_status INTEGER,
  check_count INTEGER NOT NULL DEFAULT 1
);
DROP INDEX IF EXISTS idx_video_death_list_video_id;
DROP INDEX IF EXISTS idx_video_death_list_detected_at;

CREATE TABLE IF NOT EXISTS video_liveness_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  phase TEXT NOT NULL DEFAULT 'base' CHECK (phase IN ('base', 'death')),
  base_cursor_id INTEGER NOT NULL DEFAULT 0,
  base_upper_id INTEGER NOT NULL DEFAULT 0,
  death_cursor_key TEXT NOT NULL DEFAULT '',
  death_upper_key TEXT NOT NULL DEFAULT '',
  cycle INTEGER NOT NULL DEFAULT 0,
  checked_total INTEGER NOT NULL DEFAULT 0,
  dead_total INTEGER NOT NULL DEFAULT 0,
  revived_total INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  last_checked_count INTEGER NOT NULL DEFAULT 0,
  last_dead_count INTEGER NOT NULL DEFAULT 0,
  last_revived_count INTEGER NOT NULL DEFAULT 0,
  last_unknown_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  lock_token TEXT,
  lock_until TEXT
);
INSERT OR IGNORE INTO video_liveness_state (id, phase) VALUES (1, 'base');

CREATE TABLE IF NOT EXISTS manual_import_jobs (
  job_id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  total_urls INTEGER NOT NULL CHECK (total_urls > 20 AND total_urls <= 2000),
  total_chunks INTEGER NOT NULL CHECK (total_chunks > 1),
  next_chunk INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  combined_feed_count INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'finalizing', 'completed', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  last_error TEXT,
  lock_token TEXT,
  lock_until TEXT,
  CHECK (next_chunk >= 0 AND next_chunk <= total_chunks)
);

CREATE TABLE IF NOT EXISTS manual_import_job_chunks (
  job_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  urls_json TEXT NOT NULL CHECK (json_valid(urls_json)),
  url_count INTEGER NOT NULL CHECK (url_count > 0 AND url_count <= 20),
  PRIMARY KEY (job_id, chunk_index),
  FOREIGN KEY (job_id) REFERENCES manual_import_jobs(job_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_manual_import_jobs_queue
  ON manual_import_jobs(status, lock_until, created_at, job_id);

CREATE TRIGGER IF NOT EXISTS video_death_keep_status
AFTER UPDATE OF status ON videos
WHEN NEW.status NOT IN ('dead', 'hidden')
  AND EXISTS (
    SELECT 1 FROM video_death_list
    WHERE canonical_key = NEW.canonical_key
  )
BEGIN
  UPDATE videos SET status = 'dead'
  WHERE id = NEW.id AND status <> 'dead';
END;

CREATE TRIGGER IF NOT EXISTS video_death_skip_ranking
BEFORE INSERT ON ranking_entries
WHEN EXISTS (
  SELECT 1 FROM video_death_list AS death
  INNER JOIN videos AS video ON video.canonical_key = death.canonical_key
  WHERE video.id = NEW.video_id
)
BEGIN
  SELECT RAISE(IGNORE);
END;
