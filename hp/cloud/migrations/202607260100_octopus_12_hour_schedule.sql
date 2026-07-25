PRAGMA foreign_keys = ON;

-- Refresh complete Octopus daily totals twice per day while preserving an
-- already queued immediate or earlier run.
UPDATE jobs
   SET interval_seconds = 43200,
       next_run_at = CASE
         WHEN next_run_at = 0 THEN 0
         ELSE MIN(next_run_at, unixepoch() + 43200)
       END
 WHERE name = 'octopus';

INSERT OR REPLACE INTO schema_meta(key, value)
VALUES ('schema_version', '20260726-octopus-12-hour-schedule');
