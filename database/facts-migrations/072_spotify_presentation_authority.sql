-- Spotify presentation metadata can arrive before its ISRC is known. In that
-- case migration 062's ISRC-keyed trigger cannot update sh_track_dictionary,
-- leaving provisional Stationhead romanization ahead of authoritative Spotify
-- title/artist while artwork already comes from sh_track_metadata.
--
-- Reconcile and maintain the dictionary by spotify_id as a second identity
-- path. Higher-confidence sources win; a newer value from the same source may
-- replace an older localization. Unknown/manual owners remain protected.

WITH ranked AS (
  SELECT
    NULLIF(TRIM(spotify_id),'') AS spotify_id,
    CASE WHEN title IS NULL OR TRIM(title)='' OR TRIM(title)=TRIM(spotify_id)
      THEN NULL ELSE TRIM(title) END AS title,
    CASE WHEN artist IS NULL OR TRIM(artist)='' OR TRIM(artist)=TRIM(spotify_id)
        OR TRIM(artist) GLOB 'JP[A-Z0-9]*'
      THEN NULL ELSE TRIM(artist) END AS artist,
    NULLIF(TRIM(thumbnail_url),'') AS thumbnail_url,
    source,
    fetched_at,
    CASE source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 0 END AS source_rank,
    ROW_NUMBER() OVER (
      PARTITION BY NULLIF(TRIM(spotify_id),'')
      ORDER BY CASE source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 0 END DESC,
               fetched_at DESC
    ) AS row_rank
  FROM sh_track_metadata
  WHERE spotify_id IS NOT NULL AND TRIM(spotify_id)<>''
    AND source IN ('spotify_oembed','isrc_peer')
), best AS (
  SELECT * FROM ranked WHERE row_rank=1
)
UPDATE sh_track_dictionary AS d
SET
  title=CASE WHEN b.title IS NOT NULL AND (
      b.source_rank > (CASE COALESCE(d.metadata_source,'unknown')
        WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
        WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
        WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      OR (b.source=d.metadata_source AND b.fetched_at>=d.metadata_fetched_at)
    ) THEN b.title ELSE d.title END,
  artist=CASE WHEN b.artist IS NOT NULL AND (
      b.source_rank > (CASE COALESCE(d.metadata_source,'unknown')
        WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
        WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
        WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      OR (b.source=d.metadata_source AND b.fetched_at>=d.metadata_fetched_at)
    ) THEN b.artist ELSE d.artist END,
  thumbnail_url=CASE WHEN b.thumbnail_url IS NOT NULL AND (
      b.source_rank > (CASE COALESCE(d.metadata_source,'unknown')
        WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
        WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
        WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
      OR (b.source=d.metadata_source AND b.fetched_at>=d.metadata_fetched_at)
    ) THEN b.thumbnail_url ELSE d.thumbnail_url END,
  metadata_source=CASE WHEN (b.title IS NOT NULL OR b.artist IS NOT NULL OR b.thumbnail_url IS NOT NULL)
      AND (
        b.source_rank > (CASE COALESCE(d.metadata_source,'unknown')
          WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
          WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
          WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
        OR (b.source=d.metadata_source AND b.fetched_at>=d.metadata_fetched_at)
      ) THEN b.source ELSE d.metadata_source END,
  metadata_fetched_at=MAX(d.metadata_fetched_at,b.fetched_at),
  updated_at=MAX(d.updated_at,b.fetched_at)
FROM best AS b
WHERE b.spotify_id=d.spotify_id;

DROP TRIGGER IF EXISTS trg_sh_track_dictionary_spotify_metadata_insert;
DROP TRIGGER IF EXISTS trg_sh_track_dictionary_spotify_metadata_update;

CREATE TRIGGER trg_sh_track_dictionary_spotify_metadata_insert
AFTER INSERT ON sh_track_metadata
WHEN NEW.spotify_id IS NOT NULL AND TRIM(NEW.spotify_id)<>''
  AND NEW.source IN ('spotify_oembed','isrc_peer')
BEGIN
  UPDATE sh_track_dictionary
  SET
    title=CASE WHEN NEW.title IS NOT NULL AND TRIM(NEW.title)<>''
        AND TRIM(NEW.title)<>TRIM(NEW.spotify_id)
        AND (
          (CASE NEW.source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 0 END)
            > (CASE COALESCE(metadata_source,'unknown')
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
          OR (NEW.source=metadata_source AND NEW.fetched_at>=metadata_fetched_at)
        ) THEN TRIM(NEW.title) ELSE title END,
    artist=CASE WHEN NEW.artist IS NOT NULL AND TRIM(NEW.artist)<>''
        AND TRIM(NEW.artist)<>TRIM(NEW.spotify_id)
        AND TRIM(NEW.artist) NOT GLOB 'JP[A-Z0-9]*'
        AND (
          (CASE NEW.source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 0 END)
            > (CASE COALESCE(metadata_source,'unknown')
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
          OR (NEW.source=metadata_source AND NEW.fetched_at>=metadata_fetched_at)
        ) THEN TRIM(NEW.artist) ELSE artist END,
    thumbnail_url=CASE WHEN NEW.thumbnail_url IS NOT NULL AND TRIM(NEW.thumbnail_url)<>''
        AND (
          (CASE NEW.source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 0 END)
            > (CASE COALESCE(metadata_source,'unknown')
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
          OR (NEW.source=metadata_source AND NEW.fetched_at>=metadata_fetched_at)
        ) THEN TRIM(NEW.thumbnail_url) ELSE thumbnail_url END,
    metadata_source=CASE WHEN (
        NULLIF(TRIM(NEW.title),'') IS NOT NULL
        OR NULLIF(TRIM(NEW.artist),'') IS NOT NULL
        OR NULLIF(TRIM(NEW.thumbnail_url),'') IS NOT NULL
      ) AND (
        (CASE NEW.source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 0 END)
          > (CASE COALESCE(metadata_source,'unknown')
            WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
            WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
            WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
        OR (NEW.source=metadata_source AND NEW.fetched_at>=metadata_fetched_at)
      ) THEN NEW.source ELSE metadata_source END,
    metadata_fetched_at=MAX(metadata_fetched_at,NEW.fetched_at),
    updated_at=MAX(updated_at,NEW.fetched_at)
  WHERE spotify_id=TRIM(NEW.spotify_id);
END;

CREATE TRIGGER trg_sh_track_dictionary_spotify_metadata_update
AFTER UPDATE OF spotify_id,title,artist,thumbnail_url,source,fetched_at ON sh_track_metadata
WHEN NEW.spotify_id IS NOT NULL AND TRIM(NEW.spotify_id)<>''
  AND NEW.source IN ('spotify_oembed','isrc_peer')
  AND (OLD.spotify_id IS NOT NEW.spotify_id OR OLD.title IS NOT NEW.title
    OR OLD.artist IS NOT NEW.artist OR OLD.thumbnail_url IS NOT NEW.thumbnail_url
    OR OLD.source IS NOT NEW.source OR OLD.fetched_at IS NOT NEW.fetched_at)
BEGIN
  UPDATE sh_track_dictionary
  SET
    title=CASE WHEN NEW.title IS NOT NULL AND TRIM(NEW.title)<>''
        AND TRIM(NEW.title)<>TRIM(NEW.spotify_id)
        AND (
          (CASE NEW.source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 0 END)
            > (CASE COALESCE(metadata_source,'unknown')
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
          OR (NEW.source=metadata_source AND NEW.fetched_at>=metadata_fetched_at)
        ) THEN TRIM(NEW.title) ELSE title END,
    artist=CASE WHEN NEW.artist IS NOT NULL AND TRIM(NEW.artist)<>''
        AND TRIM(NEW.artist)<>TRIM(NEW.spotify_id)
        AND TRIM(NEW.artist) NOT GLOB 'JP[A-Z0-9]*'
        AND (
          (CASE NEW.source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 0 END)
            > (CASE COALESCE(metadata_source,'unknown')
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
          OR (NEW.source=metadata_source AND NEW.fetched_at>=metadata_fetched_at)
        ) THEN TRIM(NEW.artist) ELSE artist END,
    thumbnail_url=CASE WHEN NEW.thumbnail_url IS NOT NULL AND TRIM(NEW.thumbnail_url)<>''
        AND (
          (CASE NEW.source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 0 END)
            > (CASE COALESCE(metadata_source,'unknown')
              WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
              WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
              WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
          OR (NEW.source=metadata_source AND NEW.fetched_at>=metadata_fetched_at)
        ) THEN TRIM(NEW.thumbnail_url) ELSE thumbnail_url END,
    metadata_source=CASE WHEN (
        NULLIF(TRIM(NEW.title),'') IS NOT NULL
        OR NULLIF(TRIM(NEW.artist),'') IS NOT NULL
        OR NULLIF(TRIM(NEW.thumbnail_url),'') IS NOT NULL
      ) AND (
        (CASE NEW.source WHEN 'spotify_oembed' THEN 40 WHEN 'isrc_peer' THEN 35 ELSE 0 END)
          > (CASE COALESCE(metadata_source,'unknown')
            WHEN 'unknown' THEN 0 WHEN 'track_identity' THEN 0 WHEN 'isrc_not_found' THEN 0
            WHEN 'stationhead_queue' THEN 10 WHEN 'musicbrainz' THEN 20 WHEN 'deezer' THEN 25
            WHEN 'isrc_peer' THEN 35 WHEN 'spotify_oembed' THEN 40 ELSE 50 END)
        OR (NEW.source=metadata_source AND NEW.fetched_at>=metadata_fetched_at)
      ) THEN NEW.source ELSE metadata_source END,
    metadata_fetched_at=MAX(metadata_fetched_at,NEW.fetched_at),
    updated_at=MAX(updated_at,NEW.fetched_at)
  WHERE spotify_id=TRIM(NEW.spotify_id);
END;

PRAGMA optimize;
