PRAGMA foreign_keys = ON;

-- Refresh complete Octopus daily totals every three hours while preserving an
-- already queued immediate or earlier run.
UPDATE jobs
   SET interval_seconds = 10800,
       next_run_at = CASE
         WHEN next_run_at = 0 THEN 0
         ELSE MIN(next_run_at, unixepoch() + 10800)
       END
 WHERE name = 'octopus';

INSERT OR REPLACE INTO schema_meta(key, value)
VALUES ('schema_version', '20260731-octopus-3-hour-schedule');
