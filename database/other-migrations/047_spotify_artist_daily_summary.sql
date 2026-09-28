CREATE TABLE IF NOT EXISTS sh_spotify_artist_daily (
  snapshot_date TEXT NOT NULL,
  artist_key TEXT NOT NULL,
  total_delta INTEGER,
  track_count INTEGER NOT NULL DEFAULT 0,
  top10_delta INTEGER,
  top10_year_delta INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (snapshot_date, artist_key)
);

INSERT INTO sh_spotify_artist_daily (
  snapshot_date,artist_key,total_delta,track_count,updated_at
)
SELECT
  d.snapshot_date,
  target.artist_key,
  CASE WHEN COUNT(d.delta)=0 THEN NULL ELSE SUM(d.delta) END,
  COUNT(*),
  MAX(d.collected_at)
FROM sh_spotify_playcount_daily d
INNER JOIN sh_spotify_track_targets target ON target.track_id=d.track_id
GROUP BY d.snapshot_date,target.artist_key
ON CONFLICT(snapshot_date,artist_key) DO UPDATE SET
  total_delta=excluded.total_delta,
  track_count=excluded.track_count,
  updated_at=excluded.updated_at;
