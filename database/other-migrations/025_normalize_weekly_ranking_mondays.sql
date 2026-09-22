-- Weekly Stationhead leaderboard rows are keyed by the week they represent.
-- Normalize the stored source date to that week's Monday so Tuesday/Wednesday
-- capture dates do not create separate weeks in Pages.

UPDATE sh_channel_rankings
SET ranking_date = date(
  ranking_date,
  '-' || ((CAST(strftime('%w', ranking_date) AS INTEGER) + 6) % 7) || ' days'
)
WHERE ranking_type = '週間リーダーボード'
  AND date(ranking_date) IS NOT NULL
  AND strftime('%w', ranking_date) <> '1';

CREATE TRIGGER IF NOT EXISTS trg_sh_channel_rankings_monday_insert
AFTER INSERT ON sh_channel_rankings
WHEN NEW.ranking_type = '週間リーダーボード'
  AND date(NEW.ranking_date) IS NOT NULL
  AND strftime('%w', NEW.ranking_date) <> '1'
BEGIN
  UPDATE sh_channel_rankings
  SET ranking_date = date(
    NEW.ranking_date,
    '-' || ((CAST(strftime('%w', NEW.ranking_date) AS INTEGER) + 6) % 7) || ' days'
  )
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_sh_channel_rankings_monday_update
AFTER UPDATE OF ranking_date, ranking_type ON sh_channel_rankings
WHEN NEW.ranking_type = '週間リーダーボード'
  AND date(NEW.ranking_date) IS NOT NULL
  AND strftime('%w', NEW.ranking_date) <> '1'
BEGIN
  UPDATE sh_channel_rankings
  SET ranking_date = date(
    NEW.ranking_date,
    '-' || ((CAST(strftime('%w', NEW.ranking_date) AS INTEGER) + 6) % 7) || ' days'
  )
  WHERE id = NEW.id;
END;
