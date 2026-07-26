-- Track how long work has actually waited in the inbox. A historical rebuild
-- intentionally targets an old minute, so minute_at cannot be used as queue age.

CREATE TABLE IF NOT EXISTS sh_minute_fact_pending_age (
  id TEXT PRIMARY KEY,
  oldest_pending_at INTEGER,
  updated_at INTEGER NOT NULL,
  CHECK(id='global')
) WITHOUT ROWID;

INSERT INTO sh_minute_fact_pending_age(id,oldest_pending_at,updated_at)
SELECT
  'global',
  MIN(CASE WHEN status='pending' THEN updated_at END),
  unixepoch()*1000
FROM sh_minute_fact_jobs
WHERE 1=1
ON CONFLICT(id) DO UPDATE SET
  oldest_pending_at=excluded.oldest_pending_at,
  updated_at=excluded.updated_at;

DROP TRIGGER IF EXISTS trg_sh_minute_fact_pending_age_insert;
CREATE TRIGGER trg_sh_minute_fact_pending_age_insert
AFTER INSERT ON sh_minute_fact_jobs
WHEN NEW.status='pending'
BEGIN
  UPDATE sh_minute_fact_pending_age SET
    oldest_pending_at=CASE
      WHEN oldest_pending_at IS NULL OR NEW.updated_at<oldest_pending_at
        THEN NEW.updated_at
      ELSE oldest_pending_at
    END,
    updated_at=MAX(updated_at,NEW.updated_at)
  WHERE id='global';
END;

DROP TRIGGER IF EXISTS trg_sh_minute_fact_pending_age_delete;
CREATE TRIGGER trg_sh_minute_fact_pending_age_delete
AFTER DELETE ON sh_minute_fact_jobs
WHEN OLD.status='pending'
BEGIN
  UPDATE sh_minute_fact_pending_age SET
    oldest_pending_at=CASE
      WHEN oldest_pending_at=OLD.updated_at
        THEN (SELECT MIN(updated_at) FROM sh_minute_fact_jobs WHERE status='pending')
      ELSE oldest_pending_at
    END,
    updated_at=unixepoch()*1000
  WHERE id='global';
END;

DROP TRIGGER IF EXISTS trg_sh_minute_fact_pending_age_update;
CREATE TRIGGER trg_sh_minute_fact_pending_age_update
AFTER UPDATE OF status,updated_at ON sh_minute_fact_jobs
WHEN OLD.status IS NOT NEW.status
  OR (NEW.status='pending' AND OLD.updated_at IS NOT NEW.updated_at)
BEGIN
  UPDATE sh_minute_fact_pending_age SET
    oldest_pending_at=CASE
      WHEN NEW.status='pending' AND (
        oldest_pending_at IS NULL OR NEW.updated_at<oldest_pending_at
      ) THEN NEW.updated_at
      WHEN OLD.status='pending'
        AND oldest_pending_at=OLD.updated_at
        AND (NEW.status<>'pending' OR NEW.updated_at<>OLD.updated_at)
        THEN (SELECT MIN(updated_at) FROM sh_minute_fact_jobs WHERE status='pending')
      ELSE oldest_pending_at
    END,
    updated_at=MAX(updated_at,NEW.updated_at)
  WHERE id='global';
END;
