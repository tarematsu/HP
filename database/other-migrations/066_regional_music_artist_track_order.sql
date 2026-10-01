-- Preserve provider list positions per artist, including shared collaboration tracks.
CREATE TABLE IF NOT EXISTS regional_music_artist_track_order (
  snapshot_date TEXT NOT NULL,
  service TEXT NOT NULL,
  canonical_artist TEXT NOT NULL CHECK(canonical_artist IN ('sakurazaka46','hinatazaka46','nogizaka46','aobazaka46')),
  service_artist_id TEXT,
  service_track_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK(position > 0),
  rank_source TEXT NOT NULL CHECK(rank_source IN ('provider_rank','provider_popularity_order','artist_page_order')),
  PRIMARY KEY(snapshot_date,service,canonical_artist,service_track_id)
);
CREATE INDEX IF NOT EXISTS idx_regional_artist_track_order_latest
  ON regional_music_artist_track_order(service,canonical_artist,observed_at DESC,position);
