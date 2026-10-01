-- Materialize title+artist identity lookups into one indexed owner so runtime
-- callers do not repeatedly probe four metadata tables. Negative rows are
-- written lazily by the Worker with a bounded expiry.

CREATE TABLE IF NOT EXISTS sh_track_identity_cache (
  identity_key TEXT PRIMARY KEY,
  spotify_id TEXT,
  isrc TEXT,
  title TEXT,
  artist TEXT,
  thumbnail_url TEXT,
  fetched_at INTEGER NOT NULL DEFAULT 0,
  unresolved_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_sh_track_identity_cache_unresolved_until
  ON sh_track_identity_cache(unresolved_until)
  WHERE unresolved_until>0;

-- Seed the cache from the canonical dictionary first. Only identities with one
-- unambiguous Spotify ID or ISRC are materialized.
INSERT INTO sh_track_identity_cache(
  identity_key,spotify_id,isrc,title,artist,thumbnail_url,
  fetched_at,unresolved_until,updated_at
)
SELECT
  lower(trim(title)) || char(31) || lower(trim(artist)) AS identity_key,
  CASE WHEN COUNT(DISTINCT NULLIF(trim(spotify_id),''))=1
    THEN MAX(NULLIF(trim(spotify_id),'')) ELSE NULL END AS spotify_id,
  CASE WHEN COUNT(DISTINCT isrc)=1 THEN MAX(isrc) ELSE NULL END AS isrc,
  MAX(trim(title)) AS title,
  MAX(trim(artist)) AS artist,
  MAX(NULLIF(trim(thumbnail_url),'')) AS thumbnail_url,
  MAX(COALESCE(metadata_fetched_at,0)) AS fetched_at,
  0,
  MAX(COALESCE(updated_at,metadata_fetched_at,0)) AS updated_at
FROM sh_track_dictionary
WHERE title IS NOT NULL AND trim(title)<>''
  AND artist IS NOT NULL AND trim(artist)<>''
GROUP BY lower(trim(title)) || char(31) || lower(trim(artist))
HAVING COUNT(DISTINCT NULLIF(trim(spotify_id),''))=1
    OR COUNT(DISTINCT isrc)=1
ON CONFLICT(identity_key) DO UPDATE SET
  spotify_id=COALESCE(excluded.spotify_id,sh_track_identity_cache.spotify_id),
  isrc=COALESCE(excluded.isrc,sh_track_identity_cache.isrc),
  title=COALESCE(excluded.title,sh_track_identity_cache.title),
  artist=COALESCE(excluded.artist,sh_track_identity_cache.artist),
  thumbnail_url=COALESCE(excluded.thumbnail_url,sh_track_identity_cache.thumbnail_url),
  fetched_at=MAX(sh_track_identity_cache.fetched_at,excluded.fetched_at),
  unresolved_until=0,
  updated_at=MAX(sh_track_identity_cache.updated_at,excluded.updated_at);

-- Invalidate an existing positive or negative identity cache entry whenever the
-- canonical dictionary changes. The next lookup repopulates it with the current
-- ambiguity checks instead of eagerly increasing write amplification here.
CREATE TRIGGER IF NOT EXISTS trg_sh_track_identity_cache_dictionary_insert
AFTER INSERT ON sh_track_dictionary
WHEN NEW.title IS NOT NULL AND trim(NEW.title)<>''
  AND NEW.artist IS NOT NULL AND trim(NEW.artist)<>''
BEGIN
  DELETE FROM sh_track_identity_cache
  WHERE identity_key=lower(trim(NEW.title)) || char(31) || lower(trim(NEW.artist));
END;

CREATE TRIGGER IF NOT EXISTS trg_sh_track_identity_cache_dictionary_update
AFTER UPDATE OF spotify_id,isrc,title,artist,thumbnail_url,metadata_fetched_at ON sh_track_dictionary
BEGIN
  DELETE FROM sh_track_identity_cache
  WHERE identity_key IN (
    lower(trim(COALESCE(OLD.title,''))) || char(31) || lower(trim(COALESCE(OLD.artist,''))),
    lower(trim(COALESCE(NEW.title,''))) || char(31) || lower(trim(COALESCE(NEW.artist,'')))
  );
END;
