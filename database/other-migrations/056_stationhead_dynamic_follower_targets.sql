-- Dynamic Stationhead follower targets.
-- source_mask: 1=fixed, 2=Buddies broadcast host, 4=Ohisama broadcast host.
CREATE TABLE IF NOT EXISTS sh_stationhead_follower_targets (
  handle TEXT PRIMARY KEY,
  source_mask INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL
) WITHOUT ROWID;

INSERT OR IGNORE INTO sh_stationhead_follower_targets(handle,source_mask,first_seen_at) VALUES
  ('sakuramankai',1,0),
  ('sakuramankai2',1,0),
  ('sakurazaka46jp',1,0),
  ('nogizaka46smej',1,0);

-- One compact JSON row per JST day keeps D1 writes at one row/day while
-- allowing the tracked handle set to grow without schema changes.
CREATE TABLE IF NOT EXISTS sh_stationhead_daily_followers_v2 (
  observed_date_jst TEXT PRIMARY KEY,
  scheduled_at INTEGER NOT NULL,
  collected_at INTEGER NOT NULL,
  followers_json TEXT NOT NULL,
  failures_json TEXT NOT NULL DEFAULT '[]'
) WITHOUT ROWID;
