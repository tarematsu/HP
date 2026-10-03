-- D1 read hotpaths: title/artist identity recovery searches canonical identity
-- sources with normalized title or artist predicates. Plain indexes cannot
-- satisfy those expressions, so SQLite was scanning the tables. Keep these
-- indexes limited to the observed canonical hot sources to avoid unnecessary
-- write amplification on secondary metadata caches.

CREATE INDEX IF NOT EXISTS idx_sh_tracks_title_identity
  ON sh_tracks(TRIM(title) COLLATE NOCASE)
  WHERE title IS NOT NULL AND artist IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sh_tracks_artist_identity
  ON sh_tracks(TRIM(artist) COLLATE NOCASE)
  WHERE title IS NOT NULL AND artist IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sh_track_dictionary_title_identity
  ON sh_track_dictionary(TRIM(title) COLLATE NOCASE)
  WHERE title IS NOT NULL AND artist IS NOT NULL;
