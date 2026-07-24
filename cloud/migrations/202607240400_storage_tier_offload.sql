PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS skip_redundant_current_state_heartbeat;
CREATE TRIGGER skip_redundant_current_state_heartbeat
BEFORE UPDATE ON current_state
WHEN OLD.content_hash IS NEW.content_hash
  AND OLD.status IS NEW.status
  AND OLD.error IS NEW.error
  AND NEW.fetched_at < OLD.fetched_at + 86400000
BEGIN
  SELECT RAISE(IGNORE);
END;

INSERT OR REPLACE INTO schema_meta(key, value)
VALUES ('storage_tier_offload', '202607240400');
