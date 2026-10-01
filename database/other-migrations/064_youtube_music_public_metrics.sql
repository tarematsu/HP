ALTER TABLE regional_music_artist_daily ADD COLUMN monthly_audience INTEGER CHECK(monthly_audience IS NULL OR monthly_audience >= 0);
ALTER TABLE regional_music_artist_daily ADD COLUMN total_views INTEGER CHECK(total_views IS NULL OR total_views >= 0);

CREATE TABLE IF NOT EXISTS regional_music_releases (
  service TEXT NOT NULL,
  service_release_id TEXT NOT NULL,
  canonical_artist TEXT NOT NULL CHECK(canonical_artist IN ('sakurazaka46','hinatazaka46','nogizaka46')),
  title TEXT,
  release_type TEXT NOT NULL DEFAULT 'unknown',
  release_year INTEGER,
  release_url TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY(service, service_release_id)
);

CREATE INDEX IF NOT EXISTS idx_regional_music_releases_service_artist
  ON regional_music_releases(service, canonical_artist, release_year DESC, title);
