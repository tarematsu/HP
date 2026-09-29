-- Stationhead comment collection has been retired. Remove all comment-only
-- storage owned by the buddies collector. Historical migrations stay intact so
-- existing databases can advance deterministically to this migration.
DROP INDEX IF EXISTS idx_sh_comment_minute_counts_bucket;
DROP TABLE IF EXISTS sh_comment_daily_counts;
DROP TABLE IF EXISTS sh_comment_minute_counts;
DROP TABLE IF EXISTS sh_comment_state;

-- comment_velocity is retained as an inert compatibility column on
-- sh_channel_snapshots until all legacy readers have migrated away from it.
UPDATE sh_channel_snapshots
SET comment_velocity = NULL
WHERE comment_velocity IS NOT NULL;
