-- The scheduler cron fires every 5 minutes; a 15-minute update_check interval
-- just adds detection latency. Poll at the cron cadence instead.
UPDATE jobs SET interval_seconds=300, next_run_at=0 WHERE name='update_check';
