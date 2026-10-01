-- Materialize the complete Spotify monthly-listener response once per collection.
-- Pages then reads one row instead of joining the full daily history on every GET.
CREATE TABLE IF NOT EXISTS sh_spotify_monthly_listeners_read_model (
  model_key TEXT PRIMARY KEY,
  rows_json TEXT NOT NULL,
  source_snapshot_date TEXT,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
