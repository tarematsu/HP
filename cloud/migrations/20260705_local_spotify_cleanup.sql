DELETE FROM current_state WHERE source = 'spotify';
DROP TABLE IF EXISTS spotify_oauth_sessions;
DROP TABLE IF EXISTS spotify_tokens;
INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('schema_version', '20260705');
