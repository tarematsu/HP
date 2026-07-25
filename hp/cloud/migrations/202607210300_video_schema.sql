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

CREATE TABLE IF NOT EXISTS worker_locks (
  name TEXT PRIMARY KEY,
  acquired_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_capture_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER,
  source_method TEXT NOT NULL,
  source_key TEXT,
  source_url TEXT,
  final_url TEXT,
  captured_at TEXT NOT NULL,
  user_agent TEXT,
  viewport_json TEXT,
  timeout_ms INTEGER,
  load_more_clicks INTEGER NOT NULL DEFAULT 0,
  html_text TEXT,
  html_truncated INTEGER NOT NULL DEFAULT 0,
  html_bytes INTEGER NOT NULL DEFAULT 0,
  dom_signal_count INTEGER NOT NULL DEFAULT 0,
  resource_url_count INTEGER NOT NULL DEFAULT 0,
  network_event_count INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  FOREIGN KEY (run_id) REFERENCES collection_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS collection_capture_network_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT,
  resource_type TEXT,
  status INTEGER,
  content_type TEXT,
  request_headers_json TEXT,
  response_headers_json TEXT,
  body_text TEXT,
  body_truncated INTEGER NOT NULL DEFAULT 0,
  body_bytes INTEGER,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES collection_capture_snapshots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS d1_maintenance_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_cleanup_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS playback_feed_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content_hash TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

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

CREATE TABLE IF NOT EXISTS video_death_list (
  canonical_key TEXT PRIMARY KEY,
  media_url TEXT NOT NULL,
  video_id INTEGER,
  detected_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  last_http_status INTEGER,
  check_count INTEGER NOT NULL DEFAULT 1
);

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
  lock_until TEXT,
  feed_dirty INTEGER NOT NULL DEFAULT 0
);

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

CREATE TABLE IF NOT EXISTS video_orientations (
  canonical_key TEXT PRIMARY KEY,
  orientation TEXT NOT NULL CHECK (
    orientation IN ('vertical', 'horizontal', 'square', 'unknown')
  )
);

CREATE TABLE IF NOT EXISTS status_counts (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_videos INTEGER NOT NULL DEFAULT 0,
  active_mp4_videos INTEGER NOT NULL DEFAULT 0,
  feed_videos INTEGER NOT NULL DEFAULT 0,
  feed_mp4_videos INTEGER NOT NULL DEFAULT 0,
  blocked_videos INTEGER NOT NULL DEFAULT 0,
  death_videos INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO d1_maintenance_state (id, last_cleanup_at) VALUES (1, 0);
INSERT OR IGNORE INTO playback_feed_state (id) VALUES (1);
INSERT OR IGNORE INTO video_liveness_state (id, phase) VALUES (1, 'base');
INSERT OR IGNORE INTO status_counts (
  id, active_videos, active_mp4_videos, feed_videos, feed_mp4_videos,
  blocked_videos, death_videos, updated_at, dirty
) VALUES (1, 0, 0, 0, 0, 0, 0, CURRENT_TIMESTAMP, 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ranking_period_rank
  ON ranking_entries(period, rank);
CREATE INDEX IF NOT EXISTS idx_videos_active_last_seen_id
  ON videos(last_seen_at DESC, id DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_videos_active_id
  ON videos(id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_videos_status_media_type
  ON videos(status, media_type);
CREATE INDEX IF NOT EXISTS idx_ranking_period_shuffle_v2
  ON ranking_entries(
    period,
    (((video_id % 2147483647) * 1103515245) % 2147483647),
    video_id
  );
CREATE INDEX IF NOT EXISTS idx_collection_runs_started
  ON collection_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_runs_method_id
  ON collection_runs(source_method, id DESC);
CREATE INDEX IF NOT EXISTS idx_collection_runs_method_started
  ON collection_runs(source_method, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_runs_incomplete
  ON collection_runs(source_method, started_at) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_collection_runs_period_id
  ON collection_runs(period, id DESC);
CREATE INDEX IF NOT EXISTS idx_reports_created
  ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_rate_limit
  ON reports(client_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_capture_snapshots_run
  ON collection_capture_snapshots(run_id);
CREATE INDEX IF NOT EXISTS idx_collection_capture_snapshots_captured
  ON collection_capture_snapshots(captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_capture_network_snapshot
  ON collection_capture_network_events(snapshot_id, sequence);
CREATE INDEX IF NOT EXISTS idx_video_blocklist_blocked_at
  ON video_blocklist(blocked_at DESC, canonical_key);
CREATE INDEX IF NOT EXISTS idx_manual_import_jobs_queue
  ON manual_import_jobs(status, lock_until, created_at, job_id);
CREATE INDEX IF NOT EXISTS idx_video_orientations_orientation_key
  ON video_orientations(orientation, canonical_key);

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

CREATE TRIGGER IF NOT EXISTS liveness_preserve_progress_on_error
AFTER UPDATE OF last_error ON video_liveness_state
WHEN NEW.id = 1 AND NEW.last_error IS NOT NULL
BEGIN
  UPDATE video_liveness_state
     SET phase = OLD.phase,
         base_cursor_id = OLD.base_cursor_id,
         base_upper_id = OLD.base_upper_id,
         death_cursor_key = OLD.death_cursor_key,
         death_upper_key = OLD.death_upper_key,
         cycle = OLD.cycle
   WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS manual_import_jobs_max_urls_insert
BEFORE INSERT ON manual_import_jobs
WHEN NEW.total_urls > 300
BEGIN
  SELECT RAISE(ABORT, 'manual import job exceeds 300 URLs');
END;

CREATE TRIGGER IF NOT EXISTS manual_import_jobs_max_urls_update
BEFORE UPDATE OF total_urls ON manual_import_jobs
WHEN NEW.total_urls > 300
BEGIN
  SELECT RAISE(ABORT, 'manual import job exceeds 300 URLs');
END;

CREATE TRIGGER IF NOT EXISTS status_counts_delta_on_block_insert
AFTER INSERT ON video_blocklist
BEGIN
  UPDATE status_counts
     SET active_videos = MAX(0, active_videos - EXISTS (
           SELECT 1 FROM videos AS video
            WHERE video.id = NEW.video_id
              AND video.status = 'active'
         )),
         active_mp4_videos = MAX(0, active_mp4_videos - EXISTS (
           SELECT 1 FROM videos AS video
            WHERE video.id = NEW.video_id
              AND video.status = 'active'
              AND video.media_type = 'mp4'
         )),
         feed_videos = MAX(0, feed_videos - EXISTS (
           SELECT 1 FROM ranking_entries AS ranking
            WHERE ranking.period = '24h'
              AND ranking.video_id = NEW.video_id
         )),
         feed_mp4_videos = MAX(0, feed_mp4_videos - EXISTS (
           SELECT 1
             FROM ranking_entries AS ranking
             INNER JOIN videos AS video ON video.id = ranking.video_id
            WHERE ranking.period = '24h'
              AND ranking.video_id = NEW.video_id
              AND video.media_type = 'mp4'
         )),
         blocked_videos = blocked_videos + 1,
         updated_at = NEW.blocked_at
   WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS status_counts_dirty_on_block_delete
AFTER DELETE ON video_blocklist
BEGIN
  UPDATE status_counts SET dirty = 1 WHERE id = 1;
END;
