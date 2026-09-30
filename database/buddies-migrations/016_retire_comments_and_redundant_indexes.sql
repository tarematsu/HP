-- Comments collection is retired. Remove the remaining aggregate storage and
-- indexes so the collector database no longer pays write/storage amplification
-- for data that is never read by the active product.
DROP INDEX IF EXISTS idx_sh_comment_minute_counts_bucket;
DROP TABLE IF EXISTS sh_comment_daily_counts;
DROP TABLE IF EXISTS sh_comment_minute_counts;
DROP TABLE IF EXISTS sh_comment_state;

-- A few rollout-era repair modules still issue defensive SELECTs against the
-- former comment tables. Keep zero-row views during the cutover so those reads
-- are harmless and storage-free; all write paths are disabled/removed.
CREATE VIEW IF NOT EXISTS sh_comment_state AS
SELECT
  CAST(NULL AS INTEGER) AS station_id,
  CAST(NULL AS INTEGER) AS last_comment_id,
  CAST(NULL AS INTEGER) AS total_count,
  CAST(NULL AS INTEGER) AS last_observed_at
WHERE 0;
CREATE VIEW IF NOT EXISTS sh_comment_minute_counts AS
SELECT
  CAST(NULL AS INTEGER) AS station_id,
  CAST(NULL AS INTEGER) AS bucket_start,
  CAST(NULL AS INTEGER) AS comment_count
WHERE 0;
CREATE VIEW IF NOT EXISTS sh_comment_daily_counts AS
SELECT
  CAST(NULL AS INTEGER) AS station_id,
  CAST(NULL AS TEXT) AS day_key,
  CAST(NULL AS INTEGER) AS comment_count
WHERE 0;

-- These state tables are keyed by their PRIMARY KEY in the active runtime.
-- Ordering by the timestamp columns is no longer used, so maintaining the
-- secondary indexes only adds writes on every checkpoint/auth/heartbeat update.
DROP INDEX IF EXISTS idx_sh_snapshot_current_time;
DROP INDEX IF EXISTS idx_sh_worker_collector_state_success;
DROP INDEX IF EXISTS idx_sh_worker_auth_control_success;
DROP INDEX IF EXISTS idx_sh_collector_failure_state_time;
DROP INDEX IF EXISTS idx_sh_collector_heartbeats_last_seen;

PRAGMA optimize;
