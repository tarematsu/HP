-- Keep the latest accepted observation separately from the 100 leaderboard rows.
-- Repeated captures with identical ranking content must not delete and reinsert
-- the same weekly Top 100 (or fire 200 ranking revision triggers).
CREATE TABLE IF NOT EXISTS sh_weekly_leaderboard_import_state (
  ranking_date TEXT PRIMARY KEY,
  observed_at INTEGER NOT NULL,
  source_digest TEXT,
  content_json TEXT NOT NULL
) WITHOUT ROWID;
