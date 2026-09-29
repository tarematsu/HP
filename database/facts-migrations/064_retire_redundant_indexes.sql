-- Retire indexes that no longer back a production read path.
--
-- idx_sh_minute_facts_live_latest is the old partial latest-live index from
-- migration 010. The covering idx_sh_minute_facts_live_minute introduced by
-- migration 025 serves the same leading live/minute access path and includes
-- the playback columns used by the current hot queries.
DROP INDEX IF EXISTS idx_sh_minute_facts_live_latest;

-- sh_total_member_daily already has PRIMARY KEY(channel_id,day_at,host_key),
-- which covers the old channel/day prefix. Current latest-member reads use the
-- covering idx_sh_total_member_daily_latest from migration 047, so maintaining
-- this older near-duplicate adds write/storage cost without a distinct read path.
DROP INDEX IF EXISTS idx_sh_total_member_daily_channel_time;
