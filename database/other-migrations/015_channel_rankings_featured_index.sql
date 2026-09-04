CREATE INDEX IF NOT EXISTS idx_other_channel_rankings_featured_date_rank
  ON sh_channel_rankings(lower(channel_name), ranking_date, rank);
