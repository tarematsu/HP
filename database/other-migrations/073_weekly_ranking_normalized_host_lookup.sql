-- The weekly-ranking reader matches normalized host names with
-- lower(trim(channel_name)); the old 015 index covers lower(channel_name)
-- instead and cannot be used for that predicate.
-- Keep the old index because other migrations may recreate it on provisioning.
CREATE INDEX IF NOT EXISTS idx_other_channel_rankings_trimmed_host_date_rank
  ON sh_channel_rankings(lower(trim(channel_name)), ranking_date, rank);
