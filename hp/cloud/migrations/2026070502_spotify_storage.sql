CREATE TABLE IF NOT EXISTS spotify_tokens (
  device_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_spotify_tokens_updated_at
  ON spotify_tokens(updated_at DESC);

CREATE TABLE IF NOT EXISTS spotify_oauth_sessions (
  state TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spotify_oauth_sessions_expires_at
  ON spotify_oauth_sessions(expires_at);

INSERT OR REPLACE INTO schema_meta(key, value)
VALUES ('schema_version', '20260705-spotify-storage');
