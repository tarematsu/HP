CREATE TABLE IF NOT EXISTS spotify_oauth_sessions (
  state TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spotify_sessions_expiry
  ON spotify_oauth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS spotify_tokens (
  device_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_spotify_tokens_updated
  ON spotify_tokens(updated_at DESC);
