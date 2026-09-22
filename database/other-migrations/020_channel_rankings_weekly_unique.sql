-- Keep one canonical row for each ranking week/type/rank before enforcing uniqueness.
-- The newest id wins when legacy imports left duplicate ranking rows behind.
DELETE FROM sh_channel_rankings
WHERE rank IS NOT NULL
  AND id NOT IN (
    SELECT MAX(id)
    FROM sh_channel_rankings
    WHERE rank IS NOT NULL
    GROUP BY ranking_date, ranking_type, rank
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_other_channel_rankings_week_type_rank_unique
ON sh_channel_rankings(ranking_date, ranking_type, rank)
WHERE rank IS NOT NULL;
