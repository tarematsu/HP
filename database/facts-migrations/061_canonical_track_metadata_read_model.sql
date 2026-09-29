-- Define one presentation-metadata owner without adding another stored copy.
-- sh_tracks.id remains the canonical track identity. sh_track_dictionary owns
-- presentation fields for ISRC-backed tracks. sh_track_metadata and
-- sh_isrc_metadata remain acquisition/retry caches and must not be read by
-- Pages/read-model consumers after this migration.

-- Reconcile any source-cache values that predate the dictionary triggers. Only
-- fill missing presentation fields; do not let a source cache overwrite the
-- canonical dictionary once a value is present.
INSERT INTO sh_track_dictionary(
  isrc,spotify_id,title,artist,thumbnail_url,
  metadata_source,metadata_fetched_at,updated_at
)
SELECT
  UPPER(REPLACE(REPLACE(TRIM(isrc),'-',''),' ','')),
  NULLIF(TRIM(spotify_id),''),
  CASE WHEN title IS NULL OR TRIM(title)='' OR TRIM(title)=TRIM(spotify_id)
    THEN NULL ELSE TRIM(title) END,
  CASE WHEN artist IS NULL OR TRIM(artist)='' OR TRIM(artist)=TRIM(spotify_id)
      OR TRIM(artist) GLOB 'JP[A-Z0-9]*'
    THEN NULL ELSE TRIM(artist) END,
  NULLIF(TRIM(thumbnail_url),''),
  source,
  fetched_at,
  fetched_at
FROM sh_track_metadata
WHERE isrc IS NOT NULL
  AND LENGTH(UPPER(REPLACE(REPLACE(TRIM(isrc),'-',''),' ','')))=12
ORDER BY fetched_at
ON CONFLICT(isrc) DO UPDATE SET
  spotify_id=COALESCE(sh_track_dictionary.spotify_id,excluded.spotify_id),
  title=CASE WHEN sh_track_dictionary.title IS NULL OR TRIM(sh_track_dictionary.title)=''
    THEN excluded.title ELSE sh_track_dictionary.title END,
  artist=CASE WHEN sh_track_dictionary.artist IS NULL OR TRIM(sh_track_dictionary.artist)=''
    THEN excluded.artist ELSE sh_track_dictionary.artist END,
  thumbnail_url=COALESCE(sh_track_dictionary.thumbnail_url,excluded.thumbnail_url),
  metadata_source=CASE
    WHEN sh_track_dictionary.metadata_source IN ('unknown','track_identity')
      THEN excluded.metadata_source
    ELSE sh_track_dictionary.metadata_source END,
  metadata_fetched_at=MAX(sh_track_dictionary.metadata_fetched_at,excluded.metadata_fetched_at),
  updated_at=MAX(sh_track_dictionary.updated_at,excluded.updated_at);

INSERT INTO sh_track_dictionary(
  isrc,spotify_id,title,artist,thumbnail_url,
  metadata_source,metadata_fetched_at,updated_at
)
SELECT
  UPPER(REPLACE(REPLACE(TRIM(isrc),'-',''),' ','')),
  NULL,
  NULLIF(TRIM(title),''),
  NULLIF(TRIM(artist),''),
  NULL,
  source,
  fetched_at,
  fetched_at
FROM sh_isrc_metadata
WHERE isrc IS NOT NULL
  AND LENGTH(UPPER(REPLACE(REPLACE(TRIM(isrc),'-',''),' ','')))=12
ORDER BY fetched_at
ON CONFLICT(isrc) DO UPDATE SET
  title=CASE WHEN sh_track_dictionary.title IS NULL OR TRIM(sh_track_dictionary.title)=''
    THEN excluded.title ELSE sh_track_dictionary.title END,
  artist=CASE WHEN sh_track_dictionary.artist IS NULL OR TRIM(sh_track_dictionary.artist)=''
    THEN excluded.artist ELSE sh_track_dictionary.artist END,
  metadata_source=CASE
    WHEN sh_track_dictionary.metadata_source IN ('unknown','track_identity')
      THEN excluded.metadata_source
    ELSE sh_track_dictionary.metadata_source END,
  metadata_fetched_at=MAX(sh_track_dictionary.metadata_fetched_at,excluded.metadata_fetched_at),
  updated_at=MAX(sh_track_dictionary.updated_at,excluded.updated_at);

-- Identity tables may know an external ID that the presentation dictionary does
-- not. Copy only identity linkage, never title/artist presentation values.
UPDATE sh_track_dictionary
SET spotify_id=COALESCE(
  spotify_id,
  (SELECT NULLIF(TRIM(t.spotify_id),'')
   FROM sh_tracks AS t
   WHERE UPPER(REPLACE(REPLACE(TRIM(t.isrc),'-',''),' ',''))=sh_track_dictionary.isrc
   ORDER BY t.last_seen_at DESC,t.id DESC LIMIT 1)
)
WHERE spotify_id IS NULL;

DROP TRIGGER IF EXISTS trg_sh_track_dictionary_track_insert;
DROP TRIGGER IF EXISTS trg_sh_track_dictionary_track_isrc_update;

CREATE TRIGGER trg_sh_track_dictionary_track_insert
AFTER INSERT ON sh_tracks
WHEN NEW.isrc IS NOT NULL
  AND LENGTH(UPPER(REPLACE(REPLACE(TRIM(NEW.isrc),'-',''),' ','')))=12
BEGIN
  INSERT INTO sh_track_dictionary(
    isrc,spotify_id,title,artist,thumbnail_url,
    metadata_source,metadata_fetched_at,updated_at
  ) VALUES(
    UPPER(REPLACE(REPLACE(TRIM(NEW.isrc),'-',''),' ','')),
    NULLIF(TRIM(NEW.spotify_id),''),NULL,NULL,NULL,
    'track_identity',0,COALESCE(NEW.last_seen_at,0)
  )
  ON CONFLICT(isrc) DO UPDATE SET
    spotify_id=COALESCE(sh_track_dictionary.spotify_id,excluded.spotify_id),
    updated_at=MAX(sh_track_dictionary.updated_at,excluded.updated_at);
END;

CREATE TRIGGER trg_sh_track_dictionary_track_isrc_update
AFTER UPDATE OF isrc,spotify_id,last_seen_at ON sh_tracks
WHEN NEW.isrc IS NOT NULL
  AND LENGTH(UPPER(REPLACE(REPLACE(TRIM(NEW.isrc),'-',''),' ','')))=12
  AND (OLD.isrc IS NOT NEW.isrc OR OLD.spotify_id IS NOT NEW.spotify_id)
BEGIN
  INSERT INTO sh_track_dictionary(
    isrc,spotify_id,title,artist,thumbnail_url,
    metadata_source,metadata_fetched_at,updated_at
  ) VALUES(
    UPPER(REPLACE(REPLACE(TRIM(NEW.isrc),'-',''),' ','')),
    NULLIF(TRIM(NEW.spotify_id),''),NULL,NULL,NULL,
    'track_identity',0,COALESCE(NEW.last_seen_at,0)
  )
  ON CONFLICT(isrc) DO UPDATE SET
    spotify_id=COALESCE(sh_track_dictionary.spotify_id,excluded.spotify_id),
    updated_at=MAX(sh_track_dictionary.updated_at,excluded.updated_at);
END;

DROP VIEW IF EXISTS sh_track_canonical_metadata;
CREATE VIEW sh_track_canonical_metadata AS
SELECT
  t.id AS track_id,
  COALESCE(
    d.isrc,
    NULLIF(UPPER(REPLACE(REPLACE(TRIM(t.isrc),'-',''),' ','')),'')
  ) AS isrc,
  COALESCE(NULLIF(TRIM(d.spotify_id),''),NULLIF(TRIM(t.spotify_id),'')) AS spotify_id,
  COALESCE(
    CASE WHEN d.title IS NULL OR TRIM(d.title)='' THEN NULL ELSE TRIM(d.title) END,
    CASE WHEN t.title IS NULL OR TRIM(t.title)='' OR TRIM(t.title)=TRIM(t.spotify_id)
      THEN NULL ELSE TRIM(t.title) END
  ) AS title,
  COALESCE(
    CASE WHEN d.artist IS NULL OR TRIM(d.artist)='' THEN NULL ELSE TRIM(d.artist) END,
    CASE WHEN t.artist IS NULL OR TRIM(t.artist)='' OR TRIM(t.artist)=TRIM(t.spotify_id)
        OR TRIM(t.artist) GLOB 'JP[A-Z0-9]*'
      THEN NULL ELSE TRIM(t.artist) END
  ) AS artist,
  d.thumbnail_url,
  COALESCE(d.metadata_source,'track_identity') AS metadata_source,
  CASE WHEN d.isrc IS NOT NULL THEN d.metadata_fetched_at ELSE t.last_seen_at END AS fetched_at
FROM sh_tracks AS t
LEFT JOIN sh_track_dictionary AS d
  ON d.isrc=UPPER(REPLACE(REPLACE(TRIM(t.isrc),'-',''),' ',''))

UNION ALL

SELECT
  NULL AS track_id,
  d.isrc,
  NULLIF(TRIM(d.spotify_id),''),
  NULLIF(TRIM(d.title),''),
  NULLIF(TRIM(d.artist),''),
  d.thumbnail_url,
  d.metadata_source,
  d.metadata_fetched_at
FROM sh_track_dictionary AS d
WHERE NOT EXISTS (
  SELECT 1 FROM sh_tracks AS t
  WHERE UPPER(REPLACE(REPLACE(TRIM(t.isrc),'-',''),' ',''))=d.isrc
)
AND NOT EXISTS (
  SELECT 1 FROM sh_tracks AS t
  WHERE d.spotify_id IS NOT NULL AND TRIM(d.spotify_id)<>''
    AND t.spotify_id=d.spotify_id
);
