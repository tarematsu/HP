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
