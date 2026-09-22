-- Weekly Stationhead leaderboard imports are one snapshot per Monday-based week.
-- Keep the newest existing row for the same natural identity before adding the
-- uniqueness guard used by the automated R2 -> D1 importer.

DELETE FROM sh_channel_rankings
WHERE id IN (
  SELECT older.id
  FROM sh_channel_rankings AS older
  JOIN sh_channel_rankings AS newer
    ON newer.ranking_date = older.ranking_date
   AND newer.ranking_type = older.ranking_type
   AND lower(trim(newer.channel_name)) = lower(trim(older.channel_name))
   AND (
        COALESCE(newer.observed_at, -1) > COALESCE(older.observed_at, -1)
        OR (
          COALESCE(newer.observed_at, -1) = COALESCE(older.observed_at, -1)
          AND newer.id > older.id
        )
      )
  WHERE older.channel_name IS NOT NULL
    AND trim(older.channel_name) <> ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_other_channel_rankings_week_type_name_unique
ON sh_channel_rankings(
  ranking_date,
  ranking_type,
  lower(trim(channel_name))
)
WHERE channel_name IS NOT NULL
  AND trim(channel_name) <> '';
