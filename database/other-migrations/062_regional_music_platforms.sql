-- Regional/local music-service observations. Keep provider-native identities here;
-- canonical track ids, when known, still refer to stationhead-minute.sh_tracks.id.
-- This schema intentionally does not CHECK service names so new regional services
-- can be added without rebuilding every table.

CREATE TABLE IF NOT EXISTS regional_music_artist_profiles (
  service TEXT NOT NULL,
  canonical_artist TEXT NOT NULL CHECK(canonical_artist IN ('sakurazaka46','hinatazaka46','nogizaka46')),
  service_artist_id TEXT NOT NULL,
  display_name TEXT,
  profile_url TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY(service,canonical_artist),
  UNIQUE(service,service_artist_id)
);

CREATE INDEX IF NOT EXISTS idx_regional_music_artist_profiles_service_id
  ON regional_music_artist_profiles(service,service_artist_id);

CREATE TABLE IF NOT EXISTS regional_music_artist_daily (
  snapshot_date TEXT NOT NULL,
  service TEXT NOT NULL,
  canonical_artist TEXT NOT NULL CHECK(canonical_artist IN ('sakurazaka46','hinatazaka46','nogizaka46')),
  observed_at INTEGER NOT NULL,
  followers INTEGER CHECK(followers IS NULL OR followers >= 0),
  likes INTEGER CHECK(likes IS NULL OR likes >= 0),
  PRIMARY KEY(snapshot_date,service,canonical_artist)
);

CREATE INDEX IF NOT EXISTS idx_regional_music_artist_daily_service_artist_date
  ON regional_music_artist_daily(service,canonical_artist,snapshot_date DESC);

CREATE TABLE IF NOT EXISTS regional_music_tracks (
  service TEXT NOT NULL,
  service_track_id TEXT NOT NULL,
  service_artist_id TEXT,
  canonical_artist TEXT CHECK(canonical_artist IS NULL OR canonical_artist IN ('sakurazaka46','hinatazaka46','nogizaka46')),
  canonical_track_id INTEGER CHECK(canonical_track_id IS NULL OR canonical_track_id > 0),
  title TEXT,
  album_name TEXT,
  track_url TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY(service,service_track_id)
);

CREATE INDEX IF NOT EXISTS idx_regional_music_tracks_artist
  ON regional_music_tracks(service,canonical_artist,last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_regional_music_tracks_canonical
  ON regional_music_tracks(canonical_track_id,service)
  WHERE canonical_track_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS regional_music_track_daily (
  snapshot_date TEXT NOT NULL,
  service TEXT NOT NULL,
  service_track_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  plays INTEGER CHECK(plays IS NULL OR plays >= 0),
  listeners INTEGER CHECK(listeners IS NULL OR listeners >= 0),
  likes INTEGER CHECK(likes IS NULL OR likes >= 0),
  comments INTEGER CHECK(comments IS NULL OR comments >= 0),
  popularity_rank INTEGER CHECK(popularity_rank IS NULL OR popularity_rank > 0),
  PRIMARY KEY(snapshot_date,service,service_track_id)
);

CREATE INDEX IF NOT EXISTS idx_regional_music_track_daily_service_track_date
  ON regional_music_track_daily(service,service_track_id,snapshot_date DESC);

CREATE TABLE IF NOT EXISTS regional_music_playlists (
  service TEXT NOT NULL,
  service_playlist_id TEXT NOT NULL,
  playlist_name TEXT,
  playlist_url TEXT,
  playlist_type TEXT NOT NULL DEFAULT 'unknown'
    CHECK(playlist_type IN ('official','editorial','user','chart','unknown')),
  owner_name TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY(service,service_playlist_id)
);

CREATE TABLE IF NOT EXISTS regional_music_playlist_memberships (
  snapshot_date TEXT NOT NULL,
  service TEXT NOT NULL,
  service_playlist_id TEXT NOT NULL,
  service_track_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  position INTEGER CHECK(position IS NULL OR position > 0),
  PRIMARY KEY(snapshot_date,service,service_playlist_id,service_track_id)
);

CREATE INDEX IF NOT EXISTS idx_regional_music_playlist_memberships_track_date
  ON regional_music_playlist_memberships(service,service_track_id,snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_regional_music_playlist_memberships_playlist_date
  ON regional_music_playlist_memberships(service,service_playlist_id,snapshot_date DESC);

CREATE TABLE IF NOT EXISTS regional_music_collector_state (
  service TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pending','ok','degraded','error')),
  last_attempt_at INTEGER,
  last_success_at INTEGER,
  last_error_class TEXT,
  last_error_message TEXT,
  entity_counts_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

-- Seed every planned provider so the public read model reports the complete
-- collection matrix even before the first successful run. Active collectors
-- overwrite these rows on their first attempt.
INSERT OR IGNORE INTO regional_music_collector_state(
  service,status,last_attempt_at,last_success_at,last_error_class,last_error_message,entity_counts_json,updated_at
) VALUES
  ('genie','pending',NULL,NULL,NULL,NULL,'{}',0),
  ('bugs','pending',NULL,NULL,NULL,NULL,'{}',0),
  ('joox','pending',NULL,NULL,NULL,NULL,'{}',0),
  ('nhaccuatui','pending',NULL,NULL,NULL,NULL,'{}',0),
  ('anghami','pending',NULL,NULL,NULL,NULL,'{}',0),
  ('qq_music','pending',NULL,NULL,NULL,NULL,'{}',0),
  ('netease_cloud_music','pending',NULL,NULL,NULL,NULL,'{}',0),
  ('kugou_music','pending',NULL,NULL,NULL,NULL,'{}',0),
  ('melon','pending',NULL,NULL,NULL,NULL,'{}',0),
  ('naver_vibe','pending',NULL,NULL,NULL,NULL,'{}',0),
  ('flo','pending',NULL,NULL,NULL,NULL,'{}',0),
  ('yandex_music','pending',NULL,NULL,NULL,NULL,'{}',0),
  ('boomplay','pending',NULL,NULL,'auth_surface_pending','First-party collection requires a stable public or authorized session surface.','{}',0),
  ('plern','pending',NULL,NULL,'discovery_pending','Stable public catalog collection surface has not been verified.','{}',0),
  ('fungjai','pending',NULL,NULL,'service_scope_changed','Current service is not verified as a general streaming catalog.','{}',0),
  ('zing_mp3','pending',NULL,NULL,'signed_api_pending','Current web API depends on request signing/cookie state; no stable public collector is enabled.','{}',0),
  ('jiosaavn','pending',NULL,NULL,NULL,NULL,'{}',0),
  ('gaana','pending',NULL,NULL,NULL,NULL,'{}',0),
  ('langit_musik','pending',NULL,NULL,'terms_restricted','Automated collection is not enabled because published terms prohibit automated crawling/scraping.','{}',0);
