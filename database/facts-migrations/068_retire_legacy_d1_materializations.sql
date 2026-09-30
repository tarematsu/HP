-- Materialized public responses are R2-only. Retire the legacy D1 response
-- manifest/chunk copy and its redundant secondary index.
DROP INDEX IF EXISTS idx_sh_pages_response_chunks_generation;
DROP TABLE IF EXISTS sh_pages_response_chunks;
DROP TABLE IF EXISTS sh_pages_response_manifest;

-- Track History is canonical as per-day R2 objects plus the compact R2 day
-- index. The small progress/status payload table remains in D1.
DROP INDEX IF EXISTS idx_sh_pages_track_history_date;
DROP TABLE IF EXISTS sh_pages_track_history_read_model;
DROP TABLE IF EXISTS sh_pages_track_history_daily_read_model;

-- Comments collection is retired. Remove the remaining minute-side queue if an
-- older environment still contains it.
DROP INDEX IF EXISTS idx_sh_minute_comment_tasks_pending;
DROP TABLE IF EXISTS sh_minute_comment_tasks;

PRAGMA optimize;
