CREATE TABLE IF NOT EXISTS sh_spotify_maintenance_state (
  maintenance_key TEXT PRIMARY KEY,
  cursor_track_id TEXT NOT NULL DEFAULT '',
  is_complete INTEGER NOT NULL DEFAULT 0 CHECK (is_complete IN (0,1)),
  updated_at INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO sh_spotify_maintenance_state (
  maintenance_key,cursor_track_id,is_complete,updated_at
) VALUES ('legacy-alias-bootstrap-v1','',0,0);
