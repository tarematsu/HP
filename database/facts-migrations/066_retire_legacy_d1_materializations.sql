-- Track History is canonical in R2 day objects before this migration is run.
-- Remove the duplicate D1 row/day projections and their maintenance triggers.
DROP TRIGGER IF EXISTS trg_pages_track_history_daily_insert;
DROP TRIGGER IF EXISTS trg_pages_track_history_daily_delete;
DROP TRIGGER IF EXISTS trg_pages_track_history_daily_update;
DROP INDEX IF EXISTS idx_sh_pages_track_history_publication_cursor;
DROP INDEX IF EXISTS idx_sh_pages_track_history_date;
DROP TABLE IF EXISTS sh_pages_track_history_daily_read_model;
DROP TABLE IF EXISTS sh_pages_track_history_read_model;

-- Materialized API responses are served from KV/R2. The D1 chunk store is an
-- obsolete fallback and duplicates the PRIMARY KEY with an extra index.
DROP INDEX IF EXISTS idx_sh_pages_response_chunks_generation;
DROP TABLE IF EXISTS sh_pages_response_chunks;
DROP TABLE IF EXISTS sh_pages_response_manifest;

-- Comment collection is retired; no delayed comment repair queue remains.
DROP INDEX IF EXISTS idx_sh_minute_comment_tasks_pending;
DROP TABLE IF EXISTS sh_minute_comment_tasks;

PRAGMA optimize;
