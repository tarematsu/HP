-- Complete the title-identity hotpath indexes for the metadata fallback tables.
-- Runtime identity recovery uses `TRIM(title) COLLATE NOCASE IN (...)`; without
-- matching expression indexes SQLite scans these caches on every lookup.

CREATE INDEX IF NOT EXISTS idx_sh_track_metadata_title_identity
  ON sh_track_metadata(TRIM(title) COLLATE NOCASE)
  WHERE title IS NOT NULL AND artist IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sh_isrc_metadata_title_identity
  ON sh_isrc_metadata(TRIM(title) COLLATE NOCASE)
  WHERE title IS NOT NULL AND artist IS NOT NULL;
