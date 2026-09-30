-- Persist only failed daily follower attempts. Successful snapshots continue to
-- use sh_stationhead_daily_followers_v2, keeping normal write volume unchanged.
CREATE TABLE IF NOT EXISTS sh_stationhead_daily_follower_failures (
  observed_date_jst TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  failed_at INTEGER NOT NULL,
  error TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (observed_date_jst, scheduled_at)
);

CREATE INDEX IF NOT EXISTS idx_sh_stationhead_daily_follower_failures_date
  ON sh_stationhead_daily_follower_failures(observed_date_jst, failed_at);
