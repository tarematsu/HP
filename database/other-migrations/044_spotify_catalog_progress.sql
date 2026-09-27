ALTER TABLE sh_spotify_collection_runs
  ADD COLUMN catalog_total INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sh_spotify_collection_runs
  ADD COLUMN catalog_completed INTEGER NOT NULL DEFAULT 0;
