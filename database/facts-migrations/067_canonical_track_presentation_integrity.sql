-- Keep sh_tracks.id as the canonical song identity while making the canonical
-- presentation view complete for both ISRC-backed and Spotify-only tracks.
-- Provider metadata remains an acquisition cache; Pages/read-model consumers
-- continue to read only sh_track_canonical_metadata.

-- Existing rows that were previously considered complete without artwork must
-- be eligible for enrichment immediately after deployment.
UPDATE sh_track_metadata
SET fetched_at=0
WHERE thumbnail_url IS NULL OR TRIM(thumbnail_url)='';

UPDATE sh_isrc_metadata
SET fetched_at=0
WHERE thumbnail_url IS NULL OR TRIM(thumbnail_url)='';

DROP VIEW IF EXISTS sh_track_canonical_metadata;
CREATE VIEW sh_track_canonical_metadata AS
SELECT
  t.id AS track_id,
  COALESCE(
    d.isrc,
    NULLIF(UPPER(REPLACE(REPLACE(TRIM(t.isrc),'-',''),' ','')),''),
    NULLIF(UPPER(REPLACE(REPLACE(TRIM(m.isrc),'-',''),' ','')),'')
  ) AS isrc,
  COALESCE(
    NULLIF(TRIM(d.spotify_id),''),
    NULLIF(TRIM(t.spotify_id),''),
    NULLIF(TRIM(m.spotify_id),'')
  ) AS spotify_id,
  COALESCE(
    CASE WHEN d.title IS NULL OR TRIM(d.title)='' THEN NULL ELSE TRIM(d.title) END,
    CASE WHEN m.title IS NULL OR TRIM(m.title)='' OR TRIM(m.title)=TRIM(m.spotify_id)
      THEN NULL ELSE TRIM(m.title) END,
    CASE WHEN t.title IS NULL OR TRIM(t.title)='' OR TRIM(t.title)=TRIM(t.spotify_id)
      THEN NULL ELSE TRIM(t.title) END
  ) AS title,
  COALESCE(
    CASE WHEN d.artist IS NULL OR TRIM(d.artist)='' THEN NULL ELSE TRIM(d.artist) END,
    CASE WHEN m.artist IS NULL OR TRIM(m.artist)='' OR TRIM(m.artist)=TRIM(m.spotify_id)
        OR TRIM(m.artist) GLOB 'JP[A-Z0-9]*'
      THEN NULL ELSE TRIM(m.artist) END,
    CASE WHEN t.artist IS NULL OR TRIM(t.artist)='' OR TRIM(t.artist)=TRIM(t.spotify_id)
        OR TRIM(t.artist) GLOB 'JP[A-Z0-9]*'
      THEN NULL ELSE TRIM(t.artist) END
  ) AS artist,
  COALESCE(
    NULLIF(TRIM(d.thumbnail_url),''),
    NULLIF(TRIM(m.thumbnail_url),'')
  ) AS thumbnail_url,
  CASE
    WHEN d.isrc IS NOT NULL AND (
      NULLIF(TRIM(d.title),'') IS NOT NULL
      OR NULLIF(TRIM(d.artist),'') IS NOT NULL
      OR NULLIF(TRIM(d.thumbnail_url),'') IS NOT NULL
    ) THEN d.metadata_source
    WHEN m.spotify_id IS NOT NULL AND (
      NULLIF(TRIM(m.title),'') IS NOT NULL
      OR NULLIF(TRIM(m.artist),'') IS NOT NULL
      OR NULLIF(TRIM(m.thumbnail_url),'') IS NOT NULL
    ) THEN COALESCE(NULLIF(TRIM(m.source),''),'spotify_metadata')
    ELSE 'track_identity'
  END AS metadata_source,
  MAX(
    COALESCE(d.metadata_fetched_at,0),
    COALESCE(m.fetched_at,0),
    COALESCE(t.last_seen_at,0)
  ) AS fetched_at
FROM sh_tracks AS t
LEFT JOIN sh_track_dictionary AS d
  ON d.isrc=UPPER(REPLACE(REPLACE(TRIM(t.isrc),'-',''),' ',''))
LEFT JOIN sh_track_metadata AS m
  ON m.spotify_id=COALESCE(
    NULLIF(TRIM(d.spotify_id),''),
    NULLIF(TRIM(t.spotify_id),'')
  )

UNION ALL

SELECT
  NULL AS track_id,
  d.isrc,
  COALESCE(NULLIF(TRIM(d.spotify_id),''),NULLIF(TRIM(m.spotify_id),'')) AS spotify_id,
  COALESCE(
    NULLIF(TRIM(d.title),''),
    CASE WHEN m.title IS NULL OR TRIM(m.title)='' OR TRIM(m.title)=TRIM(m.spotify_id)
      THEN NULL ELSE TRIM(m.title) END
  ) AS title,
  COALESCE(
    NULLIF(TRIM(d.artist),''),
    CASE WHEN m.artist IS NULL OR TRIM(m.artist)='' OR TRIM(m.artist)=TRIM(m.spotify_id)
        OR TRIM(m.artist) GLOB 'JP[A-Z0-9]*'
      THEN NULL ELSE TRIM(m.artist) END
  ) AS artist,
  COALESCE(NULLIF(TRIM(d.thumbnail_url),''),NULLIF(TRIM(m.thumbnail_url),'')) AS thumbnail_url,
  CASE
    WHEN NULLIF(TRIM(d.title),'') IS NOT NULL
      OR NULLIF(TRIM(d.artist),'') IS NOT NULL
      OR NULLIF(TRIM(d.thumbnail_url),'') IS NOT NULL
      THEN d.metadata_source
    WHEN m.spotify_id IS NOT NULL THEN COALESCE(NULLIF(TRIM(m.source),''),'spotify_metadata')
    ELSE d.metadata_source
  END AS metadata_source,
  MAX(COALESCE(d.metadata_fetched_at,0),COALESCE(m.fetched_at,0)) AS fetched_at
FROM sh_track_dictionary AS d
LEFT JOIN sh_track_metadata AS m
  ON m.spotify_id=NULLIF(TRIM(d.spotify_id),'')
WHERE NOT EXISTS (
  SELECT 1 FROM sh_tracks AS t
  WHERE UPPER(REPLACE(REPLACE(TRIM(t.isrc),'-',''),' ',''))=d.isrc
)
AND NOT EXISTS (
  SELECT 1 FROM sh_tracks AS t
  WHERE d.spotify_id IS NOT NULL AND TRIM(d.spotify_id)<>''
    AND t.spotify_id=d.spotify_id
);

PRAGMA optimize;
