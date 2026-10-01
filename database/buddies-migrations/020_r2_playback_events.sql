-- Event-oriented playback persistence for the one-minute Buddies collector.
-- The live current+5 queue state is held in R2; D1 stores only durable playback events and daily summaries.

CREATE TABLE IF NOT EXISTS sh_track_plays (
  event_key TEXT PRIMARY KEY,
  played_at INTEGER NOT NULL,
  period_key TEXT NOT NULL,
  station_id INTEGER,
  track_key TEXT NOT NULL,
  spotify_id TEXT,
  isrc TEXT,
  title TEXT,
  artist TEXT,
  duration_ms INTEGER,
  thumbnail_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_sh_track_plays_period
  ON sh_track_plays(period_key DESC, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_sh_track_plays_track
  ON sh_track_plays(track_key, played_at DESC);

CREATE TABLE IF NOT EXISTS sh_track_daily_summary (
  period_key TEXT PRIMARY KEY,
  total_plays INTEGER NOT NULL,
  unique_tracks INTEGER NOT NULL,
  tracks_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sh_track_daily_summary_period
  ON sh_track_daily_summary(period_key DESC);
