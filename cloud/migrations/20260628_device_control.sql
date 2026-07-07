CREATE TABLE IF NOT EXISTS device_configs (
  device_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS device_commands (
  id INTEGER PRIMARY KEY,
  device_id TEXT NOT NULL,
  command TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  delivered_at INTEGER,
  completed_at INTEGER,
  success INTEGER,
  result TEXT
);

CREATE INDEX IF NOT EXISTS idx_device_commands_pending
  ON device_commands(device_id, completed_at, expires_at, delivered_at, id);

CREATE TABLE IF NOT EXISTS device_metrics (
  id INTEGER PRIMARY KEY,
  device_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_metrics_device_time
  ON device_metrics(device_id, observed_at DESC);
