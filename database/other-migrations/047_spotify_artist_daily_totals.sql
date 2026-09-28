CREATE TABLE IF NOT EXISTS sh_spotify_artist_daily (
  snapshot_date TEXT NOT NULL,
  artist_key TEXT NOT NULL,
  total_delta INTEGER,
  PRIMARY KEY(snapshot_date,artist_key)
) WITHOUT ROWID;

INSERT INTO sh_spotify_artist_daily(snapshot_date,artist_key,total_delta)
SELECT
  d.snapshot_date,
  target.artist_key,
  CASE WHEN COUNT(d.delta)=0 THEN NULL ELSE SUM(d.delta) END
FROM sh_spotify_playcount_daily d
INNER JOIN sh_spotify_track_targets target ON target.track_id=d.track_id
WHERE d.snapshot_date >= date(
  (SELECT MAX(snapshot_date) FROM sh_spotify_playcount_daily),
  '-89 days'
)
GROUP BY d.snapshot_date,target.artist_key
ON CONFLICT(snapshot_date,artist_key) DO UPDATE SET
  total_delta=excluded.total_delta;
