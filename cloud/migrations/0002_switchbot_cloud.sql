UPDATE jobs
   SET interval_seconds = 60,
       next_run_at = 0,
       lease_until = NULL
 WHERE name = 'switchbot';

INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('schema_version', '2');
