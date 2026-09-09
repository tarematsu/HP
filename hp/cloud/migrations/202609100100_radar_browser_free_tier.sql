-- Browser Run on Workers Free allows ten browser-minutes per day. Limit radar
-- composition to 48 launches/day while retaining a useful half-hour cadence.
UPDATE jobs
   SET interval_seconds = 1800,
       next_run_at = CASE
         WHEN next_run_at = 0 THEN 0
         ELSE MIN(next_run_at, unixepoch() + 1800)
       END
 WHERE name = 'radar';
