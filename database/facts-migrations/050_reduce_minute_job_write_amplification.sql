-- The partial ready/lease indexes supersede the original status-wide pending
-- index. Keeping both makes every minute-job status transition rewrite an
-- additional index entry.
DROP INDEX IF EXISTS idx_sh_minute_fact_jobs_pending;

-- UPDATE OF fires whenever status appears in SET, even when payload_clearable
-- already has the required value. Avoid the secondary no-op row write on the
-- high-frequency pending/processing transitions.
DROP TRIGGER IF EXISTS trg_sh_minute_fact_payload_after_job_done;
CREATE TRIGGER trg_sh_minute_fact_payload_after_job_done
AFTER UPDATE OF status ON sh_minute_fact_jobs
WHEN OLD.status IS NOT NEW.status
BEGIN
  UPDATE sh_minute_fact_jobs
  SET payload_clearable=CASE WHEN NEW.status='done' AND NOT EXISTS (
    SELECT 1 FROM sh_queue_revisions revisions
    WHERE revisions.source_job_id=NEW.id
      AND (revisions.status<>'complete'
        OR COALESCE(revisions.materialized_item_count,0)
          <COALESCE(revisions.source_visible_count,revisions.item_count,0))
  ) THEN 1 ELSE 0 END
  WHERE id=NEW.id
    AND payload_clearable IS NOT CASE WHEN NEW.status='done' AND NOT EXISTS (
      SELECT 1 FROM sh_queue_revisions revisions
      WHERE revisions.source_job_id=NEW.id
        AND (revisions.status<>'complete'
          OR COALESCE(revisions.materialized_item_count,0)
            <COALESCE(revisions.source_visible_count,revisions.item_count,0))
    ) THEN 1 ELSE 0 END;
END;
