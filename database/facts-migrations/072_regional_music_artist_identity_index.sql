-- Observability showed regional music canonicalization repeatedly scanning
-- sh_tracks with contains-LIKE artist predicates. Keep the common exact-artist
-- path seekable; collaboration/combined artist strings remain a rare fallback.
CREATE INDEX IF NOT EXISTS idx_sh_tracks_artist_identity
  ON sh_tracks(TRIM(artist) COLLATE NOCASE)
  WHERE title IS NOT NULL AND artist IS NOT NULL;
