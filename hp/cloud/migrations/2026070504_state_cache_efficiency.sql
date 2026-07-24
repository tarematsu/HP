CREATE TRIGGER IF NOT EXISTS skip_redundant_current_state_heartbeat
BEFORE UPDATE ON current_state
WHEN NEW.version = OLD.version
 AND NEW.payload IS OLD.payload
 AND NEW.status IS OLD.status
 AND NEW.error IS OLD.error
 AND NEW.content_hash IS OLD.content_hash
 AND NEW.fetched_at - OLD.fetched_at < 900000
BEGIN
  SELECT RAISE(IGNORE);
END;

INSERT OR REPLACE INTO schema_meta(key, value)
VALUES ('schema_version', '20260705-state-cache-efficiency');
