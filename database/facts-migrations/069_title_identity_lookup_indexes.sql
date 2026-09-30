-- D1 read hotpath: title/artist identity recovery searches these two canonical
-- identity sources with `TRIM(title) COLLATE NOCASE IN (...)`. Plain title
-- indexes cannot satisfy that expression, so SQLite was scanning the tables.
-- Keep the indexes limited to the two hot sources observed in production to
-- avoid unnecessary write amplification on the secondary metadata caches.

CREATE INDEX IF NOT EXISTS idx_sh_tracks_title_identity
  ON sh_tracks(TRIM(title) COLLATE NOCASE)
  WHERE title IS NOT NULL AND artist IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sh_track_dictionary_title_identity
  ON sh_track_dictionary(TRIM(title) COLLATE NOCASE)
  WHERE title IS NOT NULL AND artist IS NOT NULL;
