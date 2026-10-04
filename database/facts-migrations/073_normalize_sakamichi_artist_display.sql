-- Spotify and Stationhead can return romanized Sakamichi artist names even
-- when the track title/artwork are otherwise correct. Normalize only the three
-- known group aliases; all other artist names remain untouched.

UPDATE sh_track_metadata
SET
  artist=CASE LOWER(REPLACE(REPLACE(TRIM(artist),' ',''),'　',''))
    WHEN 'sakurazaka46' THEN '櫻坂46'
    WHEN 'hinatazaka46' THEN '日向坂46'
    WHEN 'nogizaka46' THEN '乃木坂46'
    ELSE artist
  END,
  display_title=CASE
    WHEN title IS NOT NULL AND TRIM(title)<>'' THEN
      TRIM(title) || ' — ' || CASE LOWER(REPLACE(REPLACE(TRIM(artist),' ',''),'　',''))
        WHEN 'sakurazaka46' THEN '櫻坂46'
        WHEN 'hinatazaka46' THEN '日向坂46'
        WHEN 'nogizaka46' THEN '乃木坂46'
        ELSE TRIM(artist)
      END
    ELSE display_title
  END
WHERE LOWER(REPLACE(REPLACE(TRIM(artist),' ',''),'　',''))
  IN ('sakurazaka46','hinatazaka46','nogizaka46');

UPDATE sh_track_dictionary
SET artist=CASE LOWER(REPLACE(REPLACE(TRIM(artist),' ',''),'　',''))
  WHEN 'sakurazaka46' THEN '櫻坂46'
  WHEN 'hinatazaka46' THEN '日向坂46'
  WHEN 'nogizaka46' THEN '乃木坂46'
  ELSE artist
END
WHERE LOWER(REPLACE(REPLACE(TRIM(artist),' ',''),'　',''))
  IN ('sakurazaka46','hinatazaka46','nogizaka46');

UPDATE sh_isrc_metadata
SET artist=CASE LOWER(REPLACE(REPLACE(TRIM(artist),' ',''),'　',''))
  WHEN 'sakurazaka46' THEN '櫻坂46'
  WHEN 'hinatazaka46' THEN '日向坂46'
  WHEN 'nogizaka46' THEN '乃木坂46'
  ELSE artist
END
WHERE LOWER(REPLACE(REPLACE(TRIM(artist),' ',''),'　',''))
  IN ('sakurazaka46','hinatazaka46','nogizaka46');

UPDATE sh_tracks
SET artist=CASE LOWER(REPLACE(REPLACE(TRIM(artist),' ',''),'　',''))
  WHEN 'sakurazaka46' THEN '櫻坂46'
  WHEN 'hinatazaka46' THEN '日向坂46'
  WHEN 'nogizaka46' THEN '乃木坂46'
  ELSE artist
END
WHERE LOWER(REPLACE(REPLACE(TRIM(artist),' ',''),'　',''))
  IN ('sakurazaka46','hinatazaka46','nogizaka46');

-- Keep the presentation read model defensive as well. This prevents any future
-- writer that bypasses Worker normalization from reintroducing romanized group
-- names into Pages/read-model output without adding write-amplifying triggers.
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
    CASE
      WHEN d.artist IS NULL OR TRIM(d.artist)='' THEN NULL
      WHEN LOWER(REPLACE(REPLACE(TRIM(d.artist),' ',''),'　',''))='sakurazaka46' THEN '櫻坂46'
      WHEN LOWER(REPLACE(REPLACE(TRIM(d.artist),' ',''),'　',''))='hinatazaka46' THEN '日向坂46'
      WHEN LOWER(REPLACE(REPLACE(TRIM(d.artist),' ',''),'　',''))='nogizaka46' THEN '乃木坂46'
      ELSE TRIM(d.artist)
    END,
    CASE
      WHEN m.artist IS NULL OR TRIM(m.artist)='' OR TRIM(m.artist)=TRIM(m.spotify_id)
        OR TRIM(m.artist) GLOB 'JP[A-Z0-9]*' THEN NULL
      WHEN LOWER(REPLACE(REPLACE(TRIM(m.artist),' ',''),'　',''))='sakurazaka46' THEN '櫻坂46'
      WHEN LOWER(REPLACE(REPLACE(TRIM(m.artist),' ',''),'　',''))='hinatazaka46' THEN '日向坂46'
      WHEN LOWER(REPLACE(REPLACE(TRIM(m.artist),' ',''),'　',''))='nogizaka46' THEN '乃木坂46'
      ELSE TRIM(m.artist)
    END,
    CASE
      WHEN t.artist IS NULL OR TRIM(t.artist)='' OR TRIM(t.artist)=TRIM(t.spotify_id)
        OR TRIM(t.artist) GLOB 'JP[A-Z0-9]*' THEN NULL
      WHEN LOWER(REPLACE(REPLACE(TRIM(t.artist),' ',''),'　',''))='sakurazaka46' THEN '櫻坂46'
      WHEN LOWER(REPLACE(REPLACE(TRIM(t.artist),' ',''),'　',''))='hinatazaka46' THEN '日向坂46'
      WHEN LOWER(REPLACE(REPLACE(TRIM(t.artist),' ',''),'　',''))='nogizaka46' THEN '乃木坂46'
      ELSE TRIM(t.artist)
    END
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
    CASE
      WHEN d.artist IS NULL OR TRIM(d.artist)='' THEN NULL
      WHEN LOWER(REPLACE(REPLACE(TRIM(d.artist),' ',''),'　',''))='sakurazaka46' THEN '櫻坂46'
      WHEN LOWER(REPLACE(REPLACE(TRIM(d.artist),' ',''),'　',''))='hinatazaka46' THEN '日向坂46'
      WHEN LOWER(REPLACE(REPLACE(TRIM(d.artist),' ',''),'　',''))='nogizaka46' THEN '乃木坂46'
      ELSE TRIM(d.artist)
    END,
    CASE
      WHEN m.artist IS NULL OR TRIM(m.artist)='' OR TRIM(m.artist)=TRIM(m.spotify_id)
        OR TRIM(m.artist) GLOB 'JP[A-Z0-9]*' THEN NULL
      WHEN LOWER(REPLACE(REPLACE(TRIM(m.artist),' ',''),'　',''))='sakurazaka46' THEN '櫻坂46'
      WHEN LOWER(REPLACE(REPLACE(TRIM(m.artist),' ',''),'　',''))='hinatazaka46' THEN '日向坂46'
      WHEN LOWER(REPLACE(REPLACE(TRIM(m.artist),' ',''),'　',''))='nogizaka46' THEN '乃木坂46'
      ELSE TRIM(m.artist)
    END
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
