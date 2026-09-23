CREATE TABLE IF NOT EXISTS sh_weekly_ranking_read_model (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  source_max_ranking_date TEXT,
  payload_json TEXT NOT NULL,
  refreshed_at INTEGER NOT NULL
);
