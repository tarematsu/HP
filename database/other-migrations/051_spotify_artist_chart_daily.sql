CREATE TABLE IF NOT EXISTS sh_spotify_artist_chart_daily (
  chart_date TEXT NOT NULL,
  artist_key TEXT NOT NULL,
  spotify_artist_id TEXT NOT NULL DEFAULT '',
  artist_name TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK(rank BETWEEN 1 AND 200),
  previous_rank INTEGER,
  peak_rank INTEGER,
  streak INTEGER,
  observed_at INTEGER NOT NULL,
  received_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chart_date, artist_key),
  FOREIGN KEY (artist_key) REFERENCES sh_spotify_artists(artist_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_spotify_artist_chart_daily_artist_date
  ON sh_spotify_artist_chart_daily(artist_key, chart_date);
CREATE INDEX IF NOT EXISTS idx_spotify_artist_chart_daily_date_rank
  ON sh_spotify_artist_chart_daily(chart_date, rank);

CREATE TABLE IF NOT EXISTS sh_spotify_artist_chart_sync_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  backfill_completed INTEGER NOT NULL DEFAULT 0 CHECK(backfill_completed IN (0,1)),
  latest_chart_date TEXT,
  latest_observed_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO sh_spotify_artist_chart_sync_state (
  id, backfill_completed, latest_chart_date, latest_observed_at, updated_at
) VALUES (1, 0, NULL, NULL, 0);
