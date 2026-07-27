-- Reduce steady-state write amplification on the one-row-per-minute fact table.
-- idx_sh_minute_facts_live_minute has the same key columns as the older
-- source-minute index and is the explicitly selected production index.
DROP INDEX IF EXISTS idx_sh_minute_facts_source_minute_desc;

-- Total-listens values are already ordered by the channel/minute index used by
-- the baseline queries. The cumulative value changes infrequently, so a second
-- covering index adds a write on every minute fact without improving the seek.
DROP INDEX IF EXISTS idx_sh_minute_facts_total_listens_baseline;

-- Counter changes already have an event-identity unique index. source_record_id
-- is retained as provenance, but its second unique index duplicates retry
-- protection and is not used as a read path.
DROP INDEX IF EXISTS idx_sh_counter_changes_source;

-- Realtime history reads are bounded by observed_at and current-value reads use
-- sh_track_counter_current. No production query seeks the append-only log by
-- track_key first, so this index only amplifies each counter change.
DROP INDEX IF EXISTS idx_sh_counter_changes_track_time;
