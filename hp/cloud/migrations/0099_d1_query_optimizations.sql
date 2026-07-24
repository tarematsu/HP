UPDATE jobs
   SET interval_seconds = 300,
       next_run_at = MIN(next_run_at, unixepoch())
 WHERE name = 'switchbot';

UPDATE jobs
   SET interval_seconds = 21600,
       next_run_at = MIN(next_run_at, unixepoch())
 WHERE name = 'octopus';

CREATE INDEX IF NOT EXISTS idx_device_commands_pending
  ON device_commands(device_id, completed_at, delivered_at, expires_at, id);

CREATE INDEX IF NOT EXISTS idx_device_commands_completed
  ON device_commands(completed_at)
  WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_device_commands_expired
  ON device_commands(expires_at)
  WHERE completed_at IS NULL AND expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_job_runs_finished_at
  ON job_runs(finished_at);

CREATE TABLE IF NOT EXISTS spotify_oauth_sessions(
  state TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS spotify_tokens(
  device_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_spotify_sessions_expiry
  ON spotify_oauth_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_spotify_tokens_updated
  ON spotify_tokens(updated_at DESC);

INSERT OR REPLACE INTO schema_meta(key, value)
VALUES ('schema_version', '99');
