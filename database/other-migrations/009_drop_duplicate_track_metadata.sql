-- Cross-database cleanup cannot be performed safely by SQL migration alone.
-- provision-other-db invokes consolidate-track-metadata.mjs, verifies every
-- source Spotify row in BUDDIES_DB, and only then drops the legacy table.
SELECT 1;
