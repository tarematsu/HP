CREATE TABLE IF NOT EXISTS spotify_oauth_sessions (
  state TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spotify_oauth_sessions_expires
  ON spotify_oauth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS spotify_credentials (
  device_id TEXT PRIMARY KEY,
  encrypted_refresh_token TEXT NOT NULL,
  access_token TEXT,
  access_expires_at INTEGER NOT NULL DEFAULT 0,
  scope TEXT NOT NULL DEFAULT '',
  spotify_user_id TEXT,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER
);
