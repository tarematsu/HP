-- Keep cleanup scans bounded to rows that are already safe to delete.
-- The previous cleanup predicate used a leading-wildcard LIKE and
-- COALESCE(sent_at,created_at), which prevented the sent-row index from being
-- used and caused the daily cleanup to scan the entire sent ledger.

CREATE INDEX IF NOT EXISTS idx_sh_minute_fact_outbox_cleanup
  ON sh_minute_fact_outbox(sent_at ASC, job_id ASC)
  WHERE status='sent'
    AND (payload_json='{}' OR instr(payload_json,'"consumed":true')>0);
