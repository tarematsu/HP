-- Lightweight Stationhead ohisama collector storage.
-- Intentionally excludes chat, queue, track, like, and metadata tables.

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
