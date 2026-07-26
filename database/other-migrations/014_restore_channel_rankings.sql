-- Channel rankings remain part of the public history API, but their original
-- migration also created the retired raw snapshot archive. Recreate only the
-- actively queried ranking table for fresh OTHER_DB databases.

CREATE TABLE IF NOT EXISTS sh_channel_rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ranking_date TEXT NOT NULL,
  observed_at INTEGER,
  ranking_type TEXT NOT NULL,
  rank INTEGER,
  channel_name TEXT,
  channel_alias TEXT,
  listener_count INTEGER,
  member_count INTEGER,
  total_listens INTEGER,
  source_sheet TEXT,
  source_row INTEGER,
  quality_score REAL NOT NULL DEFAULT 1,
  quality_flags TEXT,
  raw_json TEXT,
  imported_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_other_channel_rankings_date
ON sh_channel_rankings(ranking_date, rank);
