-- Comments collection is retired. Remove the remaining aggregate storage and
-- indexes so the collector database no longer pays write/storage amplification
-- for data that is never read by the active product.
DROP INDEX IF EXISTS idx_sh_comment_minute_counts_bucket;
DROP TABLE IF EXISTS sh_comment_daily_counts;
DROP TABLE IF EXISTS sh_comment_minute_counts;
DROP TABLE IF EXISTS sh_comment_state;

-- These state tables are keyed by their PRIMARY KEY in the active runtime.
-- Ordering by the timestamp columns is no longer used, so maintaining the
-- secondary indexes only adds writes on every checkpoint/auth/heartbeat update.
DROP INDEX IF EXISTS idx_sh_snapshot_current_time;
DROP INDEX IF EXISTS idx_sh_worker_collector_state_success;
DROP INDEX IF EXISTS idx_sh_worker_auth_control_success;
DROP INDEX IF EXISTS idx_sh_collector_failure_state_time;
DROP INDEX IF EXISTS idx_sh_collector_heartbeats_last_seen;

PRAGMA optimize;
