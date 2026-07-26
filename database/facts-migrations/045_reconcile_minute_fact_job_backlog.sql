-- Reconcile legacy work left behind by earlier staged derive and repair runs.
-- Facts are unique by channel/minute, and the active gap scan can recreate an
-- old missing minute without keeping an expired Queue lease alive forever.

UPDATE sh_minute_fact_jobs
SET status='done',
    payload_json='{}',
    payload_clearable=0,
    lease_until=NULL,
    processed_at=COALESCE(processed_at, unixepoch() * 1000),
    last_error=CASE
      WHEN job_kind='repair' THEN 'retired-disabled-repair-work'
      WHEN EXISTS (
        SELECT 1 FROM sh_minute_facts facts
        WHERE facts.channel_id=sh_minute_fact_jobs.channel_id
          AND facts.minute_at=sh_minute_fact_jobs.minute_at
      ) THEN 'reconciled-existing-minute-fact'
      ELSE 'retired-stale-work-recreated-by-gap-scan'
    END,
    updated_at=unixepoch() * 1000
WHERE status IN ('pending','processing','dead')
  AND (
    job_kind='repair'
    OR minute_at < (unixepoch('now','-1 day') * 1000)
    OR EXISTS (
      SELECT 1 FROM sh_minute_facts facts
      WHERE facts.channel_id=sh_minute_fact_jobs.channel_id
        AND facts.minute_at=sh_minute_fact_jobs.minute_at
    )
  );

-- Recent expired leases remain real work. Put them back in the bounded
-- dispatcher instead of leaving them counted as permanently processing.
UPDATE sh_minute_fact_jobs
SET status='pending',
    attempts=MAX(0,attempts-1),
    next_attempt_at=0,
    lease_until=NULL,
    last_error=NULL,
    updated_at=unixepoch() * 1000
WHERE status='processing'
  AND COALESCE(lease_until,0) < (unixepoch() * 1000);
