BEGIN TRANSACTION;

DROP TABLE IF EXISTS regional_music_artist_profiles__aobazaka;
CREATE TABLE regional_music_artist_profiles__aobazaka (
  service TEXT NOT NULL,
  canonical_artist TEXT NOT NULL CHECK(canonical_artist IN ('sakurazaka46','hinatazaka46','nogizaka46','aobazaka46')),
  service_artist_id TEXT NOT NULL,
  display_name TEXT,
  profile_url TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY(service,canonical_artist),
  UNIQUE(service,service_artist_id)
);
INSERT INTO regional_music_artist_profiles__aobazaka(
  service,canonical_artist,service_artist_id,display_name,profile_url,first_seen_at,last_seen_at
)
SELECT service,canonical_artist,service_artist_id,display_name,profile_url,first_seen_at,last_seen_at
FROM regional_music_artist_profiles;
DROP TABLE regional_music_artist_profiles;
ALTER TABLE regional_music_artist_profiles__aobazaka RENAME TO regional_music_artist_profiles;
CREATE INDEX IF NOT EXISTS idx_regional_music_artist_profiles_service_id
  ON regional_music_artist_profiles(service,service_artist_id);

DROP TABLE IF EXISTS regional_music_artist_daily__aobazaka;
CREATE TABLE regional_music_artist_daily__aobazaka (
  snapshot_date TEXT NOT NULL,
  service TEXT NOT NULL,
  canonical_artist TEXT NOT NULL CHECK(canonical_artist IN ('sakurazaka46','hinatazaka46','nogizaka46','aobazaka46')),
  observed_at INTEGER NOT NULL,
  followers INTEGER CHECK(followers IS NULL OR followers >= 0),
  likes INTEGER CHECK(likes IS NULL OR likes >= 0),
  monthly_audience INTEGER CHECK(monthly_audience IS NULL OR monthly_audience >= 0),
  total_views INTEGER CHECK(total_views IS NULL OR total_views >= 0),
  PRIMARY KEY(snapshot_date,service,canonical_artist)
);
INSERT INTO regional_music_artist_daily__aobazaka(
  snapshot_date,service,canonical_artist,observed_at,followers,likes,monthly_audience,total_views
)
SELECT snapshot_date,service,canonical_artist,observed_at,followers,likes,monthly_audience,total_views
FROM regional_music_artist_daily;
DROP TABLE regional_music_artist_daily;
ALTER TABLE regional_music_artist_daily__aobazaka RENAME TO regional_music_artist_daily;
CREATE INDEX IF NOT EXISTS idx_regional_music_artist_daily_service_artist_date
  ON regional_music_artist_daily(service,canonical_artist,snapshot_date DESC);

DROP TABLE IF EXISTS regional_music_tracks__aobazaka;
CREATE TABLE regional_music_tracks__aobazaka (
  service TEXT NOT NULL,
  service_track_id TEXT NOT NULL,
  service_artist_id TEXT,
  canonical_artist TEXT CHECK(canonical_artist IS NULL OR canonical_artist IN ('sakurazaka46','hinatazaka46','nogizaka46','aobazaka46')),
  canonical_track_id INTEGER CHECK(canonical_track_id IS NULL OR canonical_track_id > 0),
  title TEXT,
  album_name TEXT,
  track_url TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY(service,service_track_id)
);
INSERT INTO regional_music_tracks__aobazaka(
  service,service_track_id,service_artist_id,canonical_artist,canonical_track_id,title,album_name,track_url,first_seen_at,last_seen_at
)
SELECT service,service_track_id,service_artist_id,canonical_artist,canonical_track_id,title,album_name,track_url,first_seen_at,last_seen_at
FROM regional_music_tracks;
DROP TABLE regional_music_tracks;
ALTER TABLE regional_music_tracks__aobazaka RENAME TO regional_music_tracks;
CREATE INDEX IF NOT EXISTS idx_regional_music_tracks_artist
  ON regional_music_tracks(service,canonical_artist,last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_regional_music_tracks_canonical
  ON regional_music_tracks(canonical_track_id,service)
  WHERE canonical_track_id IS NOT NULL;

DROP TABLE IF EXISTS regional_music_releases__aobazaka;
CREATE TABLE regional_music_releases__aobazaka (
  service TEXT NOT NULL,
  service_release_id TEXT NOT NULL,
  canonical_artist TEXT NOT NULL CHECK(canonical_artist IN ('sakurazaka46','hinatazaka46','nogizaka46','aobazaka46')),
  title TEXT,
  release_type TEXT NOT NULL DEFAULT 'unknown',
  release_year INTEGER,
  release_url TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY(service,service_release_id)
);
INSERT INTO regional_music_releases__aobazaka(
  service,service_release_id,canonical_artist,title,release_type,release_year,release_url,first_seen_at,last_seen_at
)
SELECT service,service_release_id,canonical_artist,title,release_type,release_year,release_url,first_seen_at,last_seen_at
FROM regional_music_releases;
DROP TABLE regional_music_releases;
ALTER TABLE regional_music_releases__aobazaka RENAME TO regional_music_releases;
CREATE INDEX IF NOT EXISTS idx_regional_music_releases_service_artist
  ON regional_music_releases(service,canonical_artist,release_year DESC,title);

COMMIT;
