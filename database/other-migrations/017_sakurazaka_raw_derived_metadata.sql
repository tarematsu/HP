-- Preserve Buddies-equivalent track presentation metadata derived from the
-- canonical Sakurazaka minute raw responses. OTHER_DB provisioning replays every
-- active migration, so this migration must remain idempotent.

CREATE TABLE IF NOT EXISTS sh_sakurazaka46jp_track_metadata (
  session_id INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  station_id INTEGER,
  queue_id INTEGER,
  queue_start_time INTEGER,
  position INTEGER NOT NULL,
  queue_track_id INTEGER,
  stationhead_track_id INTEGER,
  spotify_id TEXT,
  apple_music_id TEXT,
  deezer_id TEXT,
  isrc TEXT,
  duration_ms INTEGER,
  preview_url TEXT,
  bite_count INTEGER,
  title TEXT,
  artist TEXT,
  album_name TEXT,
  thumbnail_url TEXT,
  PRIMARY KEY(session_id, queue_start_time, position)
);

CREATE INDEX IF NOT EXISTS idx_sh_sakurazaka_track_metadata_session
ON sh_sakurazaka46jp_track_metadata(session_id, observed_at, position);

PRAGMA optimize;
