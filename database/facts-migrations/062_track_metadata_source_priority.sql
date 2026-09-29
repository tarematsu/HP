-- Treat Stationhead queue metadata as provisional presentation data.
-- sh_tracks.id remains the canonical identity; sh_track_dictionary remains the
-- presentation owner. Spotify metadata may replace lower-confidence values,
-- while ISRC providers can repair Stationhead-only rows and supply artwork.

ALTER TABLE sh_isrc_metadata ADD COLUMN thumbnail_url TEXT;

DROP INDEX IF EXISTS idx_sh_isrc_metadata_incomplete;
CREATE INDEX IF NOT EXISTS idx_sh_isrc_metadata_incomplete
  ON sh_isrc_metadata(fetched_at)
  WHERE title IS NULL OR TRIM(title)=''
     OR artist IS NULL OR TRIM(artist)=''
     OR thumbnail_url IS NULL OR TRIM(thumbnail_url)='';

-- Reconcile existing ISRC cache rows over provisional Stationhead metadata.
INSERT INTO sh_track_dictionary(
  isrc,spotify_id,title,artist,thumbnail_url,
  metadata_source,metadata_fetched_at,updated_at
)
SELECT
  UPPER(REPLACE(REPLACE(TRIM(isrc),'-',''),' ','')),
  NULL,
  NULLIF(TRIM(title),''),
  NULLIF(TRIM(artist),''),
  NULLIF(TRIM(thumbnail_url),''),
  source,
  fetched_at,
  fetched_at
FROM sh_isrc_metadata
WHERE isrc IS NOT NULL
  AND LENGTH(UPPER(REPLACE(REPLACE(TRIM(isrc),'-',''),' ','')))=12
ON CONFLICT(isrc) DO UPDATE SET
  title=CASE
    WHEN excluded.title IS NOT NULL AND (
      sh_track_dictionary.title IS NULL OR TRIM(sh_track_dictionary.title)=''
      OR (CASE excluded.metadata_source
            WHEN 'deezer' THEN 25 WHEN 'musicbrainz' THEN 20 ELSE 15 END)
         > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0
              WHEN 'isrc_not_found' THEN 0 WHEN 'stationhead_queue' THEN 10
              WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40
              ELSE 50 END)
    ) THEN excluded.title ELSE sh_track_dictionary.title END,
  artist=CASE
    WHEN excluded.artist IS NOT NULL AND (
      sh_track_dictionary.artist IS NULL OR TRIM(sh_track_dictionary.artist)=''
      OR (CASE excluded.metadata_source
            WHEN 'deezer' THEN 25 WHEN 'musicbrainz' THEN 20 ELSE 15 END)
         > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0
              WHEN 'isrc_not_found' THEN 0 WHEN 'stationhead_queue' THEN 10
              WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40
              ELSE 50 END)
    ) THEN excluded.artist ELSE sh_track_dictionary.artist END,
  thumbnail_url=CASE
    WHEN excluded.thumbnail_url IS NOT NULL AND (
      sh_track_dictionary.thumbnail_url IS NULL OR TRIM(sh_track_dictionary.thumbnail_url)=''
      OR (CASE excluded.metadata_source
            WHEN 'deezer' THEN 25 WHEN 'musicbrainz' THEN 20 ELSE 15 END)
         > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0
              WHEN 'isrc_not_found' THEN 0 WHEN 'stationhead_queue' THEN 10
              WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40
              ELSE 50 END)
    ) THEN excluded.thumbnail_url ELSE sh_track_dictionary.thumbnail_url END,
  metadata_source=CASE
    WHEN (excluded.title IS NOT NULL OR excluded.artist IS NOT NULL OR excluded.thumbnail_url IS NOT NULL)
      AND (CASE excluded.metadata_source
            WHEN 'deezer' THEN 25 WHEN 'musicbrainz' THEN 20 ELSE 15 END)
          > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0
              WHEN 'isrc_not_found' THEN 0 WHEN 'stationhead_queue' THEN 10
              WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40
              ELSE 50 END)
      THEN excluded.metadata_source
    ELSE sh_track_dictionary.metadata_source END,
  metadata_fetched_at=MAX(sh_track_dictionary.metadata_fetched_at,excluded.metadata_fetched_at),
  updated_at=MAX(sh_track_dictionary.updated_at,excluded.updated_at);

-- Reconcile the best existing Spotify cache row last so it wins over all
-- provisional and ISRC-only sources without touching unknown/manual owners.
WITH ranked AS (
  SELECT
    UPPER(REPLACE(REPLACE(TRIM(isrc),'-',''),' ','')) AS normalized_isrc,
    NULLIF(TRIM(spotify_id),'') AS spotify_id,
    CASE WHEN title IS NULL OR TRIM(title)='' OR TRIM(title)=TRIM(spotify_id)
      THEN NULL ELSE TRIM(title) END AS title,
    CASE WHEN artist IS NULL OR TRIM(artist)='' OR TRIM(artist)=TRIM(spotify_id)
        OR TRIM(artist) GLOB 'JP[A-Z0-9]*'
      THEN NULL ELSE TRIM(artist) END AS artist,
    NULLIF(TRIM(thumbnail_url),'') AS thumbnail_url,
    source,
    fetched_at,
    ROW_NUMBER() OVER (
      PARTITION BY UPPER(REPLACE(REPLACE(TRIM(isrc),'-',''),' ',''))
      ORDER BY CASE source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 30 END DESC,
               fetched_at DESC
    ) AS row_rank
  FROM sh_track_metadata
  WHERE isrc IS NOT NULL
    AND LENGTH(UPPER(REPLACE(REPLACE(TRIM(isrc),'-',''),' ','')))=12
)
INSERT INTO sh_track_dictionary(
  isrc,spotify_id,title,artist,thumbnail_url,
  metadata_source,metadata_fetched_at,updated_at
)
SELECT normalized_isrc,spotify_id,title,artist,thumbnail_url,source,fetched_at,fetched_at
FROM ranked
WHERE row_rank=1
ON CONFLICT(isrc) DO UPDATE SET
  spotify_id=COALESCE(excluded.spotify_id,sh_track_dictionary.spotify_id),
  title=CASE
    WHEN excluded.title IS NOT NULL AND (
      sh_track_dictionary.title IS NULL OR TRIM(sh_track_dictionary.title)=''
      OR (CASE excluded.metadata_source
            WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 30 END)
         > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0
              WHEN 'isrc_not_found' THEN 0 WHEN 'stationhead_queue' THEN 10
              WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40
              ELSE 50 END)
    ) THEN excluded.title ELSE sh_track_dictionary.title END,
  artist=CASE
    WHEN excluded.artist IS NOT NULL AND (
      sh_track_dictionary.artist IS NULL OR TRIM(sh_track_dictionary.artist)=''
      OR (CASE excluded.metadata_source
            WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 30 END)
         > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0
              WHEN 'isrc_not_found' THEN 0 WHEN 'stationhead_queue' THEN 10
              WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40
              ELSE 50 END)
    ) THEN excluded.artist ELSE sh_track_dictionary.artist END,
  thumbnail_url=CASE
    WHEN excluded.thumbnail_url IS NOT NULL AND (
      sh_track_dictionary.thumbnail_url IS NULL OR TRIM(sh_track_dictionary.thumbnail_url)=''
      OR (CASE excluded.metadata_source
            WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 30 END)
         > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0
              WHEN 'isrc_not_found' THEN 0 WHEN 'stationhead_queue' THEN 10
              WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40
              ELSE 50 END)
    ) THEN excluded.thumbnail_url ELSE sh_track_dictionary.thumbnail_url END,
  metadata_source=CASE
    WHEN (excluded.title IS NOT NULL OR excluded.artist IS NOT NULL OR excluded.thumbnail_url IS NOT NULL)
      AND (CASE excluded.metadata_source
            WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 30 END)
          > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0
              WHEN 'isrc_not_found' THEN 0 WHEN 'stationhead_queue' THEN 10
              WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40
              ELSE 50 END)
      THEN excluded.metadata_source
    ELSE sh_track_dictionary.metadata_source END,
  metadata_fetched_at=MAX(sh_track_dictionary.metadata_fetched_at,excluded.metadata_fetched_at),
  updated_at=MAX(sh_track_dictionary.updated_at,excluded.updated_at);

-- Existing ISRC cache rows predate artwork support. Make only incomplete rows
-- immediately retryable; normal complete rows retain the seven-day cache.
UPDATE sh_isrc_metadata
SET fetched_at=0
WHERE thumbnail_url IS NULL OR TRIM(thumbnail_url)='';

DROP TRIGGER IF EXISTS trg_sh_track_dictionary_metadata_insert;
DROP TRIGGER IF EXISTS trg_sh_track_dictionary_metadata_update;
DROP TRIGGER IF EXISTS trg_sh_track_dictionary_isrc_metadata_insert;
DROP TRIGGER IF EXISTS trg_sh_track_dictionary_isrc_metadata_update;

CREATE TRIGGER trg_sh_track_dictionary_metadata_insert
AFTER INSERT ON sh_track_metadata
WHEN NEW.isrc IS NOT NULL
  AND LENGTH(UPPER(REPLACE(REPLACE(TRIM(NEW.isrc),'-',''),' ','')))=12
BEGIN
  INSERT INTO sh_track_dictionary(
    isrc,spotify_id,title,artist,thumbnail_url,
    metadata_source,metadata_fetched_at,updated_at
  ) VALUES(
    UPPER(REPLACE(REPLACE(TRIM(NEW.isrc),'-',''),' ','')),
    NULLIF(TRIM(NEW.spotify_id),''),
    CASE WHEN NEW.title IS NULL OR TRIM(NEW.title)='' OR TRIM(NEW.title)=TRIM(NEW.spotify_id)
      THEN NULL ELSE TRIM(NEW.title) END,
    CASE WHEN NEW.artist IS NULL OR TRIM(NEW.artist)='' OR TRIM(NEW.artist)=TRIM(NEW.spotify_id)
        OR TRIM(NEW.artist) GLOB 'JP[A-Z0-9]*'
      THEN NULL ELSE TRIM(NEW.artist) END,
    NULLIF(TRIM(NEW.thumbnail_url),''),
    NEW.source,NEW.fetched_at,NEW.fetched_at
  )
  ON CONFLICT(isrc) DO UPDATE SET
    spotify_id=COALESCE(excluded.spotify_id,sh_track_dictionary.spotify_id),
    title=CASE WHEN excluded.title IS NOT NULL AND (
        sh_track_dictionary.title IS NULL OR TRIM(sh_track_dictionary.title)=''
        OR (CASE excluded.metadata_source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 30 END)
          > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      ) THEN excluded.title ELSE sh_track_dictionary.title END,
    artist=CASE WHEN excluded.artist IS NOT NULL AND (
        sh_track_dictionary.artist IS NULL OR TRIM(sh_track_dictionary.artist)=''
        OR (CASE excluded.metadata_source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 30 END)
          > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      ) THEN excluded.artist ELSE sh_track_dictionary.artist END,
    thumbnail_url=CASE WHEN excluded.thumbnail_url IS NOT NULL AND (
        sh_track_dictionary.thumbnail_url IS NULL OR TRIM(sh_track_dictionary.thumbnail_url)=''
        OR (CASE excluded.metadata_source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 30 END)
          > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      ) THEN excluded.thumbnail_url ELSE sh_track_dictionary.thumbnail_url END,
    metadata_source=CASE WHEN (excluded.title IS NOT NULL OR excluded.artist IS NOT NULL OR excluded.thumbnail_url IS NOT NULL)
        AND (CASE excluded.metadata_source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 30 END)
          > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      THEN excluded.metadata_source ELSE sh_track_dictionary.metadata_source END,
    metadata_fetched_at=MAX(sh_track_dictionary.metadata_fetched_at,excluded.metadata_fetched_at),
    updated_at=MAX(sh_track_dictionary.updated_at,excluded.updated_at);
END;

CREATE TRIGGER trg_sh_track_dictionary_metadata_update
AFTER UPDATE OF isrc,spotify_id,title,artist,thumbnail_url,source,fetched_at ON sh_track_metadata
WHEN NEW.isrc IS NOT NULL
  AND LENGTH(UPPER(REPLACE(REPLACE(TRIM(NEW.isrc),'-',''),' ','')))=12
  AND (OLD.isrc IS NOT NEW.isrc OR OLD.spotify_id IS NOT NEW.spotify_id
    OR OLD.title IS NOT NEW.title OR OLD.artist IS NOT NEW.artist
    OR OLD.thumbnail_url IS NOT NEW.thumbnail_url OR OLD.source IS NOT NEW.source
    OR OLD.fetched_at IS NOT NEW.fetched_at)
BEGIN
  INSERT INTO sh_track_dictionary(
    isrc,spotify_id,title,artist,thumbnail_url,
    metadata_source,metadata_fetched_at,updated_at
  ) VALUES(
    UPPER(REPLACE(REPLACE(TRIM(NEW.isrc),'-',''),' ','')),
    NULLIF(TRIM(NEW.spotify_id),''),
    CASE WHEN NEW.title IS NULL OR TRIM(NEW.title)='' OR TRIM(NEW.title)=TRIM(NEW.spotify_id)
      THEN NULL ELSE TRIM(NEW.title) END,
    CASE WHEN NEW.artist IS NULL OR TRIM(NEW.artist)='' OR TRIM(NEW.artist)=TRIM(NEW.spotify_id)
        OR TRIM(NEW.artist) GLOB 'JP[A-Z0-9]*'
      THEN NULL ELSE TRIM(NEW.artist) END,
    NULLIF(TRIM(NEW.thumbnail_url),''),
    NEW.source,NEW.fetched_at,NEW.fetched_at
  )
  ON CONFLICT(isrc) DO UPDATE SET
    spotify_id=COALESCE(excluded.spotify_id,sh_track_dictionary.spotify_id),
    title=CASE WHEN excluded.title IS NOT NULL AND (
        sh_track_dictionary.title IS NULL OR TRIM(sh_track_dictionary.title)=''
        OR (CASE excluded.metadata_source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 30 END)
          > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      ) THEN excluded.title ELSE sh_track_dictionary.title END,
    artist=CASE WHEN excluded.artist IS NOT NULL AND (
        sh_track_dictionary.artist IS NULL OR TRIM(sh_track_dictionary.artist)=''
        OR (CASE excluded.metadata_source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 30 END)
          > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      ) THEN excluded.artist ELSE sh_track_dictionary.artist END,
    thumbnail_url=CASE WHEN excluded.thumbnail_url IS NOT NULL AND (
        sh_track_dictionary.thumbnail_url IS NULL OR TRIM(sh_track_dictionary.thumbnail_url)=''
        OR (CASE excluded.metadata_source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 30 END)
          > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      ) THEN excluded.thumbnail_url ELSE sh_track_dictionary.thumbnail_url END,
    metadata_source=CASE WHEN (excluded.title IS NOT NULL OR excluded.artist IS NOT NULL OR excluded.thumbnail_url IS NOT NULL)
        AND (CASE excluded.metadata_source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 30 END)
          > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      THEN excluded.metadata_source ELSE sh_track_dictionary.metadata_source END,
    metadata_fetched_at=MAX(sh_track_dictionary.metadata_fetched_at,excluded.metadata_fetched_at),
    updated_at=MAX(sh_track_dictionary.updated_at,excluded.updated_at);
END;

CREATE TRIGGER trg_sh_track_dictionary_isrc_metadata_insert
AFTER INSERT ON sh_isrc_metadata
WHEN NEW.isrc IS NOT NULL
  AND LENGTH(UPPER(REPLACE(REPLACE(TRIM(NEW.isrc),'-',''),' ','')))=12
BEGIN
  INSERT INTO sh_track_dictionary(
    isrc,spotify_id,title,artist,thumbnail_url,
    metadata_source,metadata_fetched_at,updated_at
  ) VALUES(
    UPPER(REPLACE(REPLACE(TRIM(NEW.isrc),'-',''),' ','')),NULL,
    NULLIF(TRIM(NEW.title),''),NULLIF(TRIM(NEW.artist),''),NULLIF(TRIM(NEW.thumbnail_url),''),
    NEW.source,NEW.fetched_at,NEW.fetched_at
  )
  ON CONFLICT(isrc) DO UPDATE SET
    title=CASE WHEN excluded.title IS NOT NULL AND (
        sh_track_dictionary.title IS NULL OR TRIM(sh_track_dictionary.title)=''
        OR (CASE excluded.metadata_source WHEN 'deezer' THEN 25 WHEN 'musicbrainz' THEN 20 ELSE 15 END)
          > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      ) THEN excluded.title ELSE sh_track_dictionary.title END,
    artist=CASE WHEN excluded.artist IS NOT NULL AND (
        sh_track_dictionary.artist IS NULL OR TRIM(sh_track_dictionary.artist)=''
        OR (CASE excluded.metadata_source WHEN 'deezer' THEN 25 WHEN 'musicbrainz' THEN 20 ELSE 15 END)
          > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      ) THEN excluded.artist ELSE sh_track_dictionary.artist END,
    thumbnail_url=CASE WHEN excluded.thumbnail_url IS NOT NULL AND (
        sh_track_dictionary.thumbnail_url IS NULL OR TRIM(sh_track_dictionary.thumbnail_url)=''
        OR (CASE excluded.metadata_source WHEN 'deezer' THEN 25 WHEN 'musicbrainz' THEN 20 ELSE 15 END)
          > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      ) THEN excluded.thumbnail_url ELSE sh_track_dictionary.thumbnail_url END,
    metadata_source=CASE WHEN (excluded.title IS NOT NULL OR excluded.artist IS NOT NULL OR excluded.thumbnail_url IS NOT NULL)
        AND (CASE excluded.metadata_source WHEN 'deezer' THEN 25 WHEN 'musicbrainz' THEN 20 ELSE 15 END)
          > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      THEN excluded.metadata_source ELSE sh_track_dictionary.metadata_source END,
    metadata_fetched_at=MAX(sh_track_dictionary.metadata_fetched_at,excluded.metadata_fetched_at),
    updated_at=MAX(sh_track_dictionary.updated_at,excluded.updated_at);
END;

CREATE TRIGGER trg_sh_track_dictionary_isrc_metadata_update
AFTER UPDATE OF title,artist,thumbnail_url,source,fetched_at ON sh_isrc_metadata
WHEN NEW.isrc IS NOT NULL
  AND LENGTH(UPPER(REPLACE(REPLACE(TRIM(NEW.isrc),'-',''),' ','')))=12
  AND (OLD.title IS NOT NEW.title OR OLD.artist IS NOT NEW.artist
    OR OLD.thumbnail_url IS NOT NEW.thumbnail_url OR OLD.source IS NOT NEW.source
    OR OLD.fetched_at IS NOT NEW.fetched_at)
BEGIN
  INSERT INTO sh_track_dictionary(
    isrc,spotify_id,title,artist,thumbnail_url,
    metadata_source,metadata_fetched_at,updated_at
  ) VALUES(
    UPPER(REPLACE(REPLACE(TRIM(NEW.isrc),'-',''),' ','')),NULL,
    NULLIF(TRIM(NEW.title),''),NULLIF(TRIM(NEW.artist),''),NULLIF(TRIM(NEW.thumbnail_url),''),
    NEW.source,NEW.fetched_at,NEW.fetched_at
  )
  ON CONFLICT(isrc) DO UPDATE SET
    title=CASE WHEN excluded.title IS NOT NULL AND (
        sh_track_dictionary.title IS NULL OR TRIM(sh_track_dictionary.title)=''
        OR (CASE excluded.metadata_source WHEN 'deezer' THEN 25 WHEN 'musicbrainz' THEN 20 ELSE 15 END)
          > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      ) THEN excluded.title ELSE sh_track_dictionary.title END,
    artist=CASE WHEN excluded.artist IS NOT NULL AND (
        sh_track_dictionary.artist IS NULL OR TRIM(sh_track_dictionary.artist)=''
        OR (CASE excluded.metadata_source WHEN 'deezer' THEN 25 WHEN 'musicbrainz' THEN 20 ELSE 15 END)
          > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      ) THEN excluded.artist ELSE sh_track_dictionary.artist END,
    thumbnail_url=CASE WHEN excluded.thumbnail_url IS NOT NULL AND (
        sh_track_dictionary.thumbnail_url IS NULL OR TRIM(sh_track_dictionary.thumbnail_url)=''
        OR (CASE excluded.metadata_source WHEN 'deezer' THEN 25 WHEN 'musicbrainz' THEN 20 ELSE 15 END)
          > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      ) THEN excluded.thumbnail_url ELSE sh_track_dictionary.thumbnail_url END,
    metadata_source=CASE WHEN (excluded.title IS NOT NULL OR excluded.artist IS NOT NULL OR excluded.thumbnail_url IS NOT NULL)
        AND (CASE excluded.metadata_source WHEN 'deezer' THEN 25 WHEN 'musicbrainz' THEN 20 ELSE 15 END)
          > (CASE sh_track_dictionary.metadata_source
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      THEN excluded.metadata_source ELSE sh_track_dictionary.metadata_source END,
    metadata_fetched_at=MAX(sh_track_dictionary.metadata_fetched_at,excluded.metadata_fetched_at),
    updated_at=MAX(sh_track_dictionary.updated_at,excluded.updated_at);
END;
