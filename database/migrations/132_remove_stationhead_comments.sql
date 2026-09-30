-- Remove the legacy Stationhead comment collection/storage path.
DROP TRIGGER IF EXISTS trg_sh_comments_count_only;
DROP TRIGGER IF EXISTS trg_sh_channel_comment_velocity;
DROP INDEX IF EXISTS idx_sh_comment_minute_counts_bucket;
DROP TABLE IF EXISTS sh_comment_daily_counts;
DROP TABLE IF EXISTS sh_comment_minute_counts;
DROP TABLE IF EXISTS sh_comment_counter_state;
DROP TABLE IF EXISTS sh_comment_state;
DROP TABLE IF EXISTS sh_comments;

-- Legacy snapshot readers may still expect this column until their schema is
-- retired; erase all stored comment-derived values immediately.
UPDATE sh_channel_snapshots
SET comment_velocity = NULL
WHERE comment_velocity IS NOT NULL;
