CREATE INDEX IF NOT EXISTS idx_environment_buckets_device_time
  ON environment_buckets(device_id, bucket_at);

CREATE INDEX IF NOT EXISTS idx_jobs_due
  ON jobs(next_run_at, lease_until);

CREATE TRIGGER IF NOT EXISTS skip_redundant_device_heartbeat_update
BEFORE UPDATE ON device_heartbeats
WHEN NEW.app_version IS OLD.app_version
 AND NEW.stationhead_ok IS OLD.stationhead_ok
 AND NEW.outbox_count IS OLD.outbox_count
 AND NEW.payload IS OLD.payload
 AND NEW.last_sequence IS OLD.last_sequence
 AND NEW.last_seen_at - OLD.last_seen_at < 900000
BEGIN
  SELECT RAISE(IGNORE);
END;

INSERT OR REPLACE INTO schema_meta(key, value)
VALUES ('schema_version', '20260705-d1-efficiency');
