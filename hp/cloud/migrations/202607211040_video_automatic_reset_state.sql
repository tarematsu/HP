CREATE TABLE IF NOT EXISTS automatic_reset_state (
  reset_key TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL,
  note TEXT
);
