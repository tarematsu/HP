-- Active collector reads these state tables by their primary keys. The
-- timestamp-order indexes are not used by runtime queries and only amplify
-- checkpoint/auth/heartbeat writes.
DROP INDEX IF EXISTS idx_sh_snapshot_current_time;
DROP INDEX IF EXISTS idx_sh_worker_collector_state_success;
DROP INDEX IF EXISTS idx_sh_worker_auth_control_success;
DROP INDEX IF EXISTS idx_sh_collector_failure_state_time;
DROP INDEX IF EXISTS idx_sh_collector_heartbeats_last_seen;

PRAGMA optimize;
