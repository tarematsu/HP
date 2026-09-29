-- Isolated official-news-driven Stationhead collection for the Nogizaka46
-- official account (nogizaka46smej). OTHER_DB provisioning replays every
-- active migration, so every statement in this file is intentionally idempotent.

CREATE TABLE IF NOT EXISTS sh_nogizaka_official_news_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  news_id TEXT NOT NULL,
  news_url TEXT NOT NULL,
  published_date TEXT,
  title TEXT NOT NULL,
  event_name TEXT NOT NULL,
  scheduled_at INTEGER,
  detected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  matched_station_id INTEGER,
  first_broadcast_at INTEGER,
  last_broadcast_at INTEGER,
  inactive_streak INTEGER NOT NULL DEFAULT 0,
  raw_text TEXT,
  UNIQUE(news_id, scheduled_at)
);

CREATE INDEX IF NOT EXISTS idx_sh_nogizaka_official_news_schedule
ON sh_nogizaka_official_news_announcements(status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_sh_nogizaka_official_news_station
ON sh_nogizaka_official_news_announcements(matched_station_id, first_broadcast_at);

CREATE TABLE IF NOT EXISTS sh_nogizaka_official_news_station_probes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  observed_minute INTEGER NOT NULL,
  station_id INTEGER,
  broadcast_id INTEGER,
  broadcast_start_time INTEGER,
  is_broadcasting INTEGER,
  listener_count INTEGER,
  guest_count INTEGER,
  total_listens INTEGER,
  status TEXT,
  chat_status TEXT,
  channel_id INTEGER,
  channel_alias TEXT,
  queue_json TEXT,
  raw_json TEXT,
  UNIQUE(announcement_id, observed_minute)
);

CREATE INDEX IF NOT EXISTS idx_sh_nogizaka_official_news_probe_time
ON sh_nogizaka_official_news_station_probes(announcement_id, observed_at);

CREATE TABLE IF NOT EXISTS sh_nogizaka46smej_main (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_at INTEGER NOT NULL,
  observed_minute INTEGER NOT NULL UNIQUE,
  buddies_station_id INTEGER,
  station_id INTEGER,
  broadcast_id INTEGER,
  broadcast_start_time INTEGER,
  is_broadcasting INTEGER NOT NULL DEFAULT 0,
  listener_count INTEGER,
  guest_count INTEGER,
  total_listens INTEGER,
  status TEXT,
  chat_status TEXT,
  channel_id INTEGER,
  channel_alias TEXT,
  raw_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sh_nogizaka46smej_main_observed
ON sh_nogizaka46smej_main(observed_at);

CREATE TABLE IF NOT EXISTS sh_nogizaka46smej_chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_at INTEGER NOT NULL,
  observed_minute INTEGER NOT NULL UNIQUE,
  station_id INTEGER,
  raw_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sh_nogizaka46smej_chat_observed
ON sh_nogizaka46smej_chat(observed_at);

CREATE TABLE IF NOT EXISTS sh_nogizaka46smej_track_metadata (
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
  PRIMARY KEY(session_id, observed_at, position)
);

CREATE INDEX IF NOT EXISTS idx_sh_nogizaka_track_metadata_session
ON sh_nogizaka46smej_track_metadata(session_id, observed_at, position);

CREATE INDEX IF NOT EXISTS idx_sh_nogizaka_track_metadata_identity
ON sh_nogizaka46smej_track_metadata(session_id, spotify_id, isrc, observed_at);

PRAGMA optimize;
