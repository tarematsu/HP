-- Retire the one-time July stream-count repair after its production run.
-- Pending repair work must not continue consuming Queue operations or D1 writes.

UPDATE sh_minute_fact_jobs
SET status='done',
    payload_json='{}',
    payload_clearable=0,
    lease_until=NULL,
    processed_at=COALESCE(processed_at, unixepoch() * 1000),
    last_error='retired-after-observability-budget-overage',
    updated_at=unixepoch() * 1000
WHERE job_kind='repair'
  AND status IN ('pending','processing','dead');

UPDATE sh_minute_fact_repairs
SET status='retired',
    last_error=COALESCE(last_error, 'retired-after-observability-budget-overage'),
    updated_at=unixepoch() * 1000
WHERE repair_key='total-listener-20260710-13-v1'
  AND status IN ('detected','queued');

INSERT INTO sh_migration_state(
  migration_key,phase,cursor_observed_at,cursor_source_id,updated_at
) VALUES(
  'repair-scan:total-listener-20260710-13-v1',
  'complete',
  1783954800000,
  0,
  unixepoch() * 1000
)
ON CONFLICT(migration_key) DO UPDATE SET
  phase='complete',
  cursor_observed_at=MAX(sh_migration_state.cursor_observed_at, excluded.cursor_observed_at),
  cursor_source_id=MAX(sh_migration_state.cursor_source_id, excluded.cursor_source_id),
  updated_at=excluded.updated_at;
