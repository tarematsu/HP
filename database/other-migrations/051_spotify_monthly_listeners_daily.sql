CREATE TABLE IF NOT EXISTS sh_spotify_artist_monthly_listeners_daily (
  snapshot_date TEXT NOT NULL,
  artist_key TEXT NOT NULL,
  monthly_listeners INTEGER NOT NULL CHECK(monthly_listeners >= 0),
  collected_at INTEGER NOT NULL,
  PRIMARY KEY (snapshot_date, artist_key)
);

CREATE INDEX IF NOT EXISTS idx_sh_spotify_artist_monthly_listeners_daily_artist_date
ON sh_spotify_artist_monthly_listeners_daily (artist_key, snapshot_date);
