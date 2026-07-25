DELETE FROM current_state WHERE source = 'spotify';
INSERT OR REPLACE INTO schema_meta(key, value)
VALUES ('schema_version', '20260705-device-spotify-only');
