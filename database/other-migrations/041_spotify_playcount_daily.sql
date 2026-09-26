CREATE TABLE IF NOT EXISTS sh_spotify_artists (
  artist_key TEXT PRIMARY KEY,
  spotify_artist_id TEXT NOT NULL UNIQUE,
  artist_name TEXT NOT NULL
);

INSERT INTO sh_spotify_artists (artist_key, spotify_artist_id, artist_name) VALUES
  ('nogizaka46', '08lN7bm4Etec8ETFxaTUmq', '乃木坂46'),
  ('sakurazaka46', '0Ti7MfCiVVQAK8zLSiqlto', '櫻坂46'),
  ('hinatazaka46', '0eQSoTI7sQENREQM8Klp2j', '日向坂46')
ON CONFLICT(artist_key) DO UPDATE SET
  spotify_artist_id=excluded.spotify_artist_id,
  artist_name=excluded.artist_name;

CREATE TABLE IF NOT EXISTS sh_spotify_releases (
  album_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  album_type TEXT NOT NULL DEFAULT '',
  release_date TEXT NOT NULL DEFAULT '',
  release_date_precision TEXT NOT NULL DEFAULT '',
  total_tracks INTEGER,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sh_spotify_release_targets (
  album_id TEXT NOT NULL,
  artist_key TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (album_id, artist_key)
);

CREATE INDEX IF NOT EXISTS idx_sh_spotify_release_targets_active
  ON sh_spotify_release_targets (is_active, artist_key, album_id);

CREATE TABLE IF NOT EXISTS sh_spotify_tracks (
  track_id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  disc_number INTEGER,
  track_number INTEGER,
  duration_ms INTEGER,
  artists_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sh_spotify_tracks_album
  ON sh_spotify_tracks (album_id, track_id);

CREATE TABLE IF NOT EXISTS sh_spotify_track_targets (
  track_id TEXT NOT NULL,
  artist_key TEXT NOT NULL,
  PRIMARY KEY (track_id, artist_key)
);

CREATE INDEX IF NOT EXISTS idx_sh_spotify_track_targets_artist
  ON sh_spotify_track_targets (artist_key, track_id);

CREATE TABLE IF NOT EXISTS sh_spotify_playcount_current (
  track_id TEXT PRIMARY KEY,
  playcount INTEGER NOT NULL CHECK (playcount >= 0),
  snapshot_date TEXT NOT NULL,
  collected_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sh_spotify_playcount_daily (
  snapshot_date TEXT NOT NULL,
  track_id TEXT NOT NULL,
  playcount INTEGER NOT NULL CHECK (playcount >= 0),
  delta INTEGER,
  collected_at INTEGER NOT NULL,
  PRIMARY KEY (snapshot_date, track_id)
);

CREATE INDEX IF NOT EXISTS idx_sh_spotify_playcount_daily_track
  ON sh_spotify_playcount_daily (track_id, snapshot_date);

CREATE TABLE IF NOT EXISTS sh_spotify_collection_runs (
  snapshot_date TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  attempt_no INTEGER NOT NULL DEFAULT 0,
  run_token TEXT NOT NULL DEFAULT '',
  albums_queued INTEGER NOT NULL DEFAULT 0,
  albums_completed INTEGER NOT NULL DEFAULT 0,
  tracks_collected INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  attempt_started_at INTEGER NOT NULL,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS sh_spotify_collection_album_runs (
  snapshot_date TEXT NOT NULL,
  run_token TEXT NOT NULL,
  album_id TEXT NOT NULL,
  status TEXT NOT NULL,
  track_count INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (snapshot_date, album_id)
);

CREATE INDEX IF NOT EXISTS idx_sh_spotify_album_runs_status
  ON sh_spotify_collection_album_runs (snapshot_date, run_token, status, album_id);

CREATE TABLE IF NOT EXISTS sh_spotify_playcount_candidates (
  snapshot_date TEXT NOT NULL,
  run_token TEXT NOT NULL,
  track_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  playcount INTEGER NOT NULL CHECK (playcount >= 0),
  collected_at INTEGER NOT NULL,
  PRIMARY KEY (snapshot_date, track_id)
);

CREATE INDEX IF NOT EXISTS idx_sh_spotify_candidates_run
  ON sh_spotify_playcount_candidates (snapshot_date, run_token, track_id);
