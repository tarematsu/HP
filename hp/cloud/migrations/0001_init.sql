PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS jobs (
  name TEXT PRIMARY KEY,
  interval_seconds INTEGER NOT NULL,
  next_run_at INTEGER NOT NULL,
  lease_until INTEGER,
  last_success_at INTEGER,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS current_state (
  source TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  observed_at INTEGER,
  fetched_at INTEGER NOT NULL,
  last_success_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('ok', 'stale', 'error')),
  error TEXT,
  content_hash TEXT
);

CREATE TABLE IF NOT EXISTS environment_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  co2 INTEGER,
  temperature REAL,
  humidity REAL,
  temperature_corrected REAL,
  humidity_corrected REAL,
  UNIQUE(device_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_environment_samples_observed_at
  ON environment_samples(observed_at);

CREATE TABLE IF NOT EXISTS power_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  watts REAL,
  payload TEXT
);

CREATE INDEX IF NOT EXISTS idx_power_samples_observed_at
  ON power_samples(observed_at);

CREATE TABLE IF NOT EXISTS daily_energy (
  day TEXT PRIMARY KEY,
  kwh REAL,
  charge_yen INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  success INTEGER NOT NULL,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_runs_job_started
  ON job_runs(job_name, started_at DESC);

CREATE TABLE IF NOT EXISTS device_heartbeats (
  device_id TEXT PRIMARY KEY,
  last_seen_at INTEGER NOT NULL,
  app_version TEXT,
  stationhead_ok INTEGER,
  outbox_count INTEGER,
  payload TEXT
);

INSERT OR IGNORE INTO jobs(name, interval_seconds, next_run_at) VALUES
  ('switchbot', 300, 0),
  ('radar', 300, 0),
  ('news', 600, 0),
  ('octopus', 1800, 0),
  ('weather', 3600, 0),
  ('stationhead', 300, 0),
  ('cleanup', 86400, 0);

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('schema_version', '1');
