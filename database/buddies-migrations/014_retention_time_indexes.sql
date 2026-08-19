-- Retention deletes filter and order by these timestamp columns. Keep a
-- dedicated leading-column index for each large table so a bounded cleanup
-- never degrades into a full-table scan.
CREATE INDEX IF NOT EXISTS idx_sh_queue_items_observed
  ON sh_queue_items(observed_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_sh_ingest_claims_observed
  ON sh_ingest_claims(observed_at ASC);

CREATE INDEX IF NOT EXISTS idx_sh_ingest_conflicts_observed
  ON sh_ingest_conflicts(observed_at ASC, id ASC);
