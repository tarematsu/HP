CREATE TABLE IF NOT EXISTS sh_spotify_song_identities (
  song_key TEXT PRIMARY KEY,
  canonical_track_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sh_spotify_song_identities_track
  ON sh_spotify_song_identities (canonical_track_id);

CREATE TABLE IF NOT EXISTS sh_spotify_track_aliases (
  source_track_id TEXT PRIMARY KEY,
  song_key TEXT NOT NULL,
  canonical_track_id TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sh_spotify_track_aliases_canonical
  ON sh_spotify_track_aliases (canonical_track_id, source_track_id);

CREATE VIEW IF NOT EXISTS sh_spotify_playcount_daily_canonical AS
SELECT
  daily.snapshot_date,
  COALESCE(alias.canonical_track_id, daily.track_id) AS track_id,
  MAX(daily.playcount) AS playcount
FROM sh_spotify_playcount_daily daily
LEFT JOIN sh_spotify_track_aliases alias
  ON alias.source_track_id=daily.track_id
GROUP BY daily.snapshot_date, COALESCE(alias.canonical_track_id, daily.track_id);
