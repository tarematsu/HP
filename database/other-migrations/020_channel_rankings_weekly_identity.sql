-- Weekly Stationhead leaderboard snapshots are authoritative per Monday week.
-- Normalize any historical duplicate host rows first, then enforce one row per
-- (ranking_date, ranking_type, normalized channel_name).

DELETE FROM sh_channel_rankings
WHERE channel_name IS NOT NULL
  AND trim(channel_name) <> ''
  AND id NOT IN (
    SELECT MAX(id)
    FROM sh_channel_rankings
    WHERE channel_name IS NOT NULL
      AND trim(channel_name) <> ''
    GROUP BY ranking_date, ranking_type, lower(trim(channel_name))
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_other_channel_rankings_week_host
ON sh_channel_rankings(ranking_date, ranking_type, lower(trim(channel_name)))
WHERE channel_name IS NOT NULL AND trim(channel_name) <> '';

CREATE INDEX IF NOT EXISTS idx_other_channel_rankings_week_source
ON sh_channel_rankings(ranking_date, ranking_type, source_sheet);
