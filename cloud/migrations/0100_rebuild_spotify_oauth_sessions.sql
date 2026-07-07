ALTER TABLE spotify_oauth_sessions RENAME TO spotify_oauth_sessions_legacy_0100;

CREATE TABLE spotify_oauth_sessions (
  state TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_spotify_oauth_sessions_expires_v2
  ON spotify_oauth_sessions(expires_at);
