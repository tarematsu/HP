-- Cross-service facts live in stationhead-other, but the canonical track id is
-- always stationhead-minute.sh_tracks.id. This table is a reference cache only;
-- it must never allocate ids on its own.
CREATE TABLE IF NOT EXISTS music_service_track_refs (
  service TEXT NOT NULL CHECK(service IN ('apple_music','amazon_music','spotify')),
  source_track_id TEXT NOT NULL,
  track_id INTEGER NOT NULL CHECK(track_id > 0),
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY(service,source_track_id)
);

CREATE INDEX IF NOT EXISTS idx_music_service_track_refs_track
  ON music_service_track_refs(track_id,service);

-- Apple Music has a small regional Top Songs surface. Keep one compact row per
-- region/day rather than one D1 row per ranked song; ranks_json contains only
-- canonical sh_tracks.id values and ranks.
CREATE TABLE IF NOT EXISTS apple_music_rank_snapshots (
  snapshot_date TEXT NOT NULL,
  region_code TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  ranks_json TEXT NOT NULL,
  PRIMARY KEY(snapshot_date,region_code)
);

CREATE INDEX IF NOT EXISTS idx_apple_music_rank_snapshots_region_date
  ON apple_music_rank_snapshots(region_code,snapshot_date DESC);

-- Amazon's public read model remains in R2, while the compact daily ranking
-- snapshot and change-history facts belong in stationhead-other.
CREATE TABLE IF NOT EXISTS amazon_music_rank_snapshots (
  snapshot_date TEXT PRIMARY KEY,
  observed_at INTEGER NOT NULL,
  ranks_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS amazon_music_chart_change_events (
  chart_id TEXT NOT NULL,
  chart_date TEXT NOT NULL,
  rank INTEGER NOT NULL,
  group_key TEXT NOT NULL,
  apple_id TEXT,
  amazon_music_id TEXT,
  previous_rank INTEGER,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY(chart_id,chart_date,rank,group_key)
);

CREATE INDEX IF NOT EXISTS idx_amazon_music_change_events_group_time
  ON amazon_music_chart_change_events(group_key,observed_at DESC);

CREATE TABLE IF NOT EXISTS amazon_music_group_rank_history (
  jst_week TEXT NOT NULL,
  group_key TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  chart_id TEXT NOT NULL,
  chart_date TEXT NOT NULL,
  rank INTEGER NOT NULL,
  previous_rank INTEGER,
  apple_id TEXT,
  amazon_music_id TEXT,
  track_id INTEGER,
  PRIMARY KEY(jst_week,group_key,observed_at,chart_id,rank)
);

CREATE INDEX IF NOT EXISTS idx_amazon_music_group_rank_history_lookup
  ON amazon_music_group_rank_history(group_key,observed_at DESC,rank,chart_date);
CREATE INDEX IF NOT EXISTS idx_amazon_music_group_rank_history_track
  ON amazon_music_group_rank_history(track_id,observed_at DESC)
  WHERE track_id IS NOT NULL;

-- Spotify already lives in stationhead-other. Backfill its existing
-- stationhead_track_id mapping (which is sh_tracks.id despite the legacy name)
-- into the common canonical reference cache and keep future mappings synced.
INSERT INTO music_service_track_refs(
  service,source_track_id,track_id,first_seen_at,last_seen_at
)
SELECT
  'spotify',source_track_id,stationhead_track_id,first_seen_at,last_seen_at
FROM sh_spotify_track_aliases
WHERE stationhead_track_id IS NOT NULL AND stationhead_track_id > 0
ON CONFLICT(service,source_track_id) DO UPDATE SET
  track_id=excluded.track_id,
  first_seen_at=MIN(music_service_track_refs.first_seen_at,excluded.first_seen_at),
  last_seen_at=MAX(music_service_track_refs.last_seen_at,excluded.last_seen_at)
WHERE music_service_track_refs.track_id<>excluded.track_id
   OR excluded.last_seen_at>music_service_track_refs.last_seen_at;

DROP TRIGGER IF EXISTS trg_spotify_track_ref_insert;
CREATE TRIGGER trg_spotify_track_ref_insert
AFTER INSERT ON sh_spotify_track_aliases
WHEN NEW.stationhead_track_id IS NOT NULL AND NEW.stationhead_track_id > 0
BEGIN
  INSERT INTO music_service_track_refs(
    service,source_track_id,track_id,first_seen_at,last_seen_at
  ) VALUES(
    'spotify',NEW.source_track_id,NEW.stationhead_track_id,NEW.first_seen_at,NEW.last_seen_at
  )
  ON CONFLICT(service,source_track_id) DO UPDATE SET
    track_id=excluded.track_id,
    first_seen_at=MIN(music_service_track_refs.first_seen_at,excluded.first_seen_at),
    last_seen_at=MAX(music_service_track_refs.last_seen_at,excluded.last_seen_at)
  WHERE music_service_track_refs.track_id<>excluded.track_id
     OR excluded.last_seen_at>music_service_track_refs.last_seen_at;
END;

DROP TRIGGER IF EXISTS trg_spotify_track_ref_update;
CREATE TRIGGER trg_spotify_track_ref_update
AFTER UPDATE OF stationhead_track_id,last_seen_at ON sh_spotify_track_aliases
WHEN NEW.stationhead_track_id IS NOT NULL AND NEW.stationhead_track_id > 0
BEGIN
  INSERT INTO music_service_track_refs(
    service,source_track_id,track_id,first_seen_at,last_seen_at
  ) VALUES(
    'spotify',NEW.source_track_id,NEW.stationhead_track_id,NEW.first_seen_at,NEW.last_seen_at
  )
  ON CONFLICT(service,source_track_id) DO UPDATE SET
    track_id=excluded.track_id,
    first_seen_at=MIN(music_service_track_refs.first_seen_at,excluded.first_seen_at),
    last_seen_at=MAX(music_service_track_refs.last_seen_at,excluded.last_seen_at)
  WHERE music_service_track_refs.track_id<>excluded.track_id
     OR excluded.last_seen_at>music_service_track_refs.last_seen_at;
END;
