-- Read-model metadata fallback resolves sparse tracks by ISRC. The BUDDIES
-- compatibility column is populated only when metadata is available, so keep
-- the index partial and avoid indexing the common NULL/blank rows.
CREATE INDEX IF NOT EXISTS idx_sh_track_metadata_isrc
  ON sh_track_metadata(isrc)
  WHERE isrc IS NOT NULL AND TRIM(isrc)<>'';
