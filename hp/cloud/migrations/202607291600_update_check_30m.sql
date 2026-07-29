-- Release publishing triggers update rollout immediately. Keep a thirty-minute
-- scheduled fallback so a missed trigger cannot postpone native updates for hours.
UPDATE jobs
   SET interval_seconds = 1800,
       next_run_at = CASE
         WHEN next_run_at = 0 THEN 0
         ELSE MIN(next_run_at, unixepoch() + 1800)
       END
 WHERE name = 'update_check';
