-- One compact row per JST day for the four fixed Stationhead accounts.
-- The wide row intentionally minimizes D1 rows written: one row/day total.
CREATE TABLE IF NOT EXISTS sh_stationhead_daily_followers (
  observed_date_jst TEXT PRIMARY KEY,
  scheduled_at INTEGER NOT NULL,
  collected_at INTEGER NOT NULL,
  sakuramankai INTEGER NOT NULL,
  sakuramankai2 INTEGER NOT NULL,
  sakurazaka46jp INTEGER NOT NULL,
  nogizaka46smej INTEGER NOT NULL
) WITHOUT ROWID;
