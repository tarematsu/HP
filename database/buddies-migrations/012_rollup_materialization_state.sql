CREATE TABLE IF NOT EXISTS sh_rollup_materialization_state (
  period_type TEXT NOT NULL CHECK(period_type IN ('run','day','week','month')),
  period_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'idle','running','dirty','facts_ready','published','empty','waiting_dependencies','quarantined'
  )),
  source_generation TEXT,
  summary_generation TEXT,
  missing_count INTEGER NOT NULL DEFAULT 0,
  stale_count INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 0,
  processing_count INTEGER NOT NULL DEFAULT 0,
  dead_count INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  published_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(period_type, period_key)
);

CREATE INDEX IF NOT EXISTS idx_sh_rollup_materialization_retry
  ON sh_rollup_materialization_state(status, next_attempt_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_sh_rollup_materialization_lease
  ON sh_rollup_materialization_state(lease_until);
