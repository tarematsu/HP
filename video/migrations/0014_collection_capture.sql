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

CREATE INDEX IF NOT EXISTS idx_collection_capture_snapshots_run
  ON collection_capture_snapshots(run_id);
CREATE INDEX IF NOT EXISTS idx_collection_capture_snapshots_captured
  ON collection_capture_snapshots(captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_capture_network_snapshot
  ON collection_capture_network_events(snapshot_id, sequence);
