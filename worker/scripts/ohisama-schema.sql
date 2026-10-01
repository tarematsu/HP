-- Lightweight Stationhead ohisama collector storage.
-- Keeps minute facts plus compact playback history and like changes.
-- Track identity is the canonical stationhead-minute sh_tracks.id; track_key is diagnostic/compatibility metadata only.

CREATE TABLE IF NOT EXISTS sh_worker_collector_state (
  id TEXT PRIMARY KEY,
  auth_token TEXT,
  device_uid TEXT,
  token_expires_at INTEGER,
  last_run_at INTEGER,
  last_success_at INTEGER,
  last_error TEXT,
  last_channel_id INTEGER,
  last_station_id INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sh_data_migrations (
  id TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sh_minute_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  minute_at INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  station_id INTEGER,
  is_broadcasting INTEGER,
  listener_count INTEGER,
  online_member_count INTEGER,
  total_member_count INTEGER,
  guest_count INTEGER,
  reported_total_listens INTEGER,
  stream_goal INTEGER,
  reported_current_stream_count INTEGER,
  UNIQUE(channel_id, minute_at)
);

CREATE INDEX IF NOT EXISTS idx_sh_minute_facts_time
  ON sh_minute_facts(minute_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_sh_minute_facts_observed
  ON sh_minute_facts(observed_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS sh_daily_summary (
  period_key TEXT PRIMARY KEY,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  listener_avg REAL,
  listener_min INTEGER,
  listener_max INTEGER,
  stream_start INTEGER,
  stream_end INTEGER,
  stream_growth INTEGER,
  member_start INTEGER,
  member_end INTEGER,
  member_growth INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sh_daily_summary_period
  ON sh_daily_summary(period_start DESC);

CREATE TABLE IF NOT EXISTS sh_track_plays (
  event_key TEXT PRIMARY KEY,
  played_at INTEGER NOT NULL,
  period_key TEXT NOT NULL,
  station_id INTEGER,
  track_id INTEGER NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_sh_track_plays_track_id
  ON sh_track_plays(track_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_sh_track_plays_track_key
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

CREATE TABLE IF NOT EXISTS sh_track_like_current (
  station_id INTEGER NOT NULL,
  track_id INTEGER NOT NULL,
  track_key TEXT NOT NULL,
  spotify_id TEXT,
  isrc TEXT,
  title TEXT,
  artist TEXT,
  like_count INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY(station_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_sh_track_like_current_count
  ON sh_track_like_current(like_count DESC, observed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sh_track_like_current_track_id
  ON sh_track_like_current(station_id, track_id);

CREATE TABLE IF NOT EXISTS sh_track_like_observations (
  station_id INTEGER NOT NULL,
  track_id INTEGER NOT NULL,
  track_key TEXT NOT NULL,
  spotify_id TEXT,
  isrc TEXT,
  title TEXT,
  artist TEXT,
  like_count INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY(station_id, track_id, observed_at)
);

CREATE INDEX IF NOT EXISTS idx_sh_track_like_observations_time
  ON sh_track_like_observations(observed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sh_track_like_observations_track_id
  ON sh_track_like_observations(station_id, track_id, observed_at);
