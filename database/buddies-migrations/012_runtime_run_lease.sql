CREATE TABLE IF NOT EXISTS sh_runtime_run_lease (
  scope TEXT PRIMARY KEY,
  ticket TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL,
  released_at INTEGER
);
