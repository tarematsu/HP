-- All music-service provider IDs are aliases. The shared internal track identity is
-- stationhead-minute.sh_tracks.id, exposed as track_id in fact tables.
ALTER TABLE regional_music_track_daily
  ADD COLUMN track_id INTEGER CHECK(track_id IS NULL OR track_id > 0);
ALTER TABLE regional_music_playlist_memberships
  ADD COLUMN track_id INTEGER CHECK(track_id IS NULL OR track_id > 0);
ALTER TABLE regional_music_artist_track_order
  ADD COLUMN track_id INTEGER CHECK(track_id IS NULL OR track_id > 0);

UPDATE regional_music_track_daily
SET track_id=(
  SELECT t.canonical_track_id
  FROM regional_music_tracks AS t
  WHERE t.service=regional_music_track_daily.service
    AND t.service_track_id=regional_music_track_daily.service_track_id
)
WHERE track_id IS NULL;

UPDATE regional_music_playlist_memberships
SET track_id=(
  SELECT t.canonical_track_id
  FROM regional_music_tracks AS t
  WHERE t.service=regional_music_playlist_memberships.service
    AND t.service_track_id=regional_music_playlist_memberships.service_track_id
)
WHERE track_id IS NULL;

UPDATE regional_music_artist_track_order
SET track_id=(
  SELECT t.canonical_track_id
  FROM regional_music_tracks AS t
  WHERE t.service=regional_music_artist_track_order.service
    AND t.service_track_id=regional_music_artist_track_order.service_track_id
)
WHERE track_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_regional_music_track_daily_track_date
  ON regional_music_track_daily(track_id,snapshot_date DESC)
  WHERE track_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_regional_music_playlist_memberships_track_id_date
  ON regional_music_playlist_memberships(track_id,snapshot_date DESC)
  WHERE track_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_regional_artist_track_order_track_id
  ON regional_music_artist_track_order(track_id,service,snapshot_date DESC)
  WHERE track_id IS NOT NULL;

-- The original table admitted only Apple Music, Amazon Music and Spotify. Rebuild
-- it without a service-name CHECK so every present and future music provider can
-- map its native ID to the same sh_tracks.id namespace.
DROP TRIGGER IF EXISTS trg_spotify_track_ref_insert;
DROP TRIGGER IF EXISTS trg_spotify_track_ref_update;
DROP TABLE IF EXISTS music_service_track_refs__all;
CREATE TABLE music_service_track_refs__all (
  service TEXT NOT NULL,
  source_track_id TEXT NOT NULL,
  track_id INTEGER NOT NULL CHECK(track_id > 0),
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY(service,source_track_id)
);
INSERT INTO music_service_track_refs__all(
  service,source_track_id,track_id,first_seen_at,last_seen_at
)
SELECT service,source_track_id,track_id,first_seen_at,last_seen_at
FROM music_service_track_refs;
DROP TABLE music_service_track_refs;
ALTER TABLE music_service_track_refs__all RENAME TO music_service_track_refs;
CREATE INDEX IF NOT EXISTS idx_music_service_track_refs_track
  ON music_service_track_refs(track_id,service);

-- Seed aliases already resolved by regional collectors.
INSERT INTO music_service_track_refs(
  service,source_track_id,track_id,first_seen_at,last_seen_at
)
SELECT service,service_track_id,canonical_track_id,first_seen_at,last_seen_at
FROM regional_music_tracks
WHERE canonical_track_id IS NOT NULL AND canonical_track_id > 0
ON CONFLICT(service,source_track_id) DO UPDATE SET
  track_id=excluded.track_id,
  first_seen_at=MIN(music_service_track_refs.first_seen_at,excluded.first_seen_at),
  last_seen_at=MAX(music_service_track_refs.last_seen_at,excluded.last_seen_at);

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

CREATE TRIGGER trg_regional_music_track_ref_insert
AFTER INSERT ON regional_music_tracks
WHEN NEW.canonical_track_id IS NOT NULL AND NEW.canonical_track_id > 0
BEGIN
  INSERT INTO music_service_track_refs(
    service,source_track_id,track_id,first_seen_at,last_seen_at
  ) VALUES(
    NEW.service,NEW.service_track_id,NEW.canonical_track_id,NEW.first_seen_at,NEW.last_seen_at
  )
  ON CONFLICT(service,source_track_id) DO UPDATE SET
    track_id=excluded.track_id,
    first_seen_at=MIN(music_service_track_refs.first_seen_at,excluded.first_seen_at),
    last_seen_at=MAX(music_service_track_refs.last_seen_at,excluded.last_seen_at);
END;

CREATE TRIGGER trg_regional_music_track_ref_update
AFTER UPDATE OF canonical_track_id,last_seen_at ON regional_music_tracks
WHEN NEW.canonical_track_id IS NOT NULL AND NEW.canonical_track_id > 0
BEGIN
  INSERT INTO music_service_track_refs(
    service,source_track_id,track_id,first_seen_at,last_seen_at
  ) VALUES(
    NEW.service,NEW.service_track_id,NEW.canonical_track_id,NEW.first_seen_at,NEW.last_seen_at
  )
  ON CONFLICT(service,source_track_id) DO UPDATE SET
    track_id=excluded.track_id,
    first_seen_at=MIN(music_service_track_refs.first_seen_at,excluded.first_seen_at),
    last_seen_at=MAX(music_service_track_refs.last_seen_at,excluded.last_seen_at);
END;
