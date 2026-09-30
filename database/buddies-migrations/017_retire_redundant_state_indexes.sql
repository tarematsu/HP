-- Active collector state rows are addressed by their primary keys. These
-- timestamp indexes are not used by the runtime and only amplify checkpoint,
-- auth, heartbeat, and failure-state writes.
DROP INDEX IF EXISTS idx_sh_snapshot_current_time;
DROP INDEX IF EXISTS idx_sh_worker_collector_state_success;
DROP INDEX IF EXISTS idx_sh_worker_auth_control_success;
DROP INDEX IF EXISTS idx_sh_collector_failure_state_time;
DROP INDEX IF EXISTS idx_sh_collector_heartbeats_last_seen;

PRAGMA optimize;
