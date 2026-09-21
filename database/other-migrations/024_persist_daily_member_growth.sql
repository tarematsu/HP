CREATE TABLE IF NOT EXISTS sh_data_repairs (
  id TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

UPDATE sh_daily_summary
SET
  member_start = (
    SELECT previous.member_end
    FROM sh_daily_summary AS previous
    WHERE previous.period_key < sh_daily_summary.period_key
      AND previous.member_end IS NOT NULL
    ORDER BY previous.period_key DESC
    LIMIT 1
  ),
  member_growth = CASE
    WHEN member_end IS NULL THEN NULL
    ELSE member_end - (
      SELECT previous.member_end
      FROM sh_daily_summary AS previous
      WHERE previous.period_key < sh_daily_summary.period_key
        AND previous.member_end IS NOT NULL
      ORDER BY previous.period_key DESC
      LIMIT 1
    )
  END
WHERE period_key < strftime('%Y-%m-%d', 'now')
  AND EXISTS (
    SELECT 1
    FROM sh_daily_summary AS previous
    WHERE previous.period_key < sh_daily_summary.period_key
      AND previous.member_end IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM sh_data_repairs WHERE id = 'daily-member-growth-v1'
  );

INSERT OR IGNORE INTO sh_data_repairs(id, applied_at)
VALUES('daily-member-growth-v1', CAST(strftime('%s', 'now') AS INTEGER) * 1000);

CREATE TRIGGER IF NOT EXISTS trg_sh_daily_summary_member_growth_insert
AFTER INSERT ON sh_daily_summary
WHEN NEW.member_end IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM sh_daily_summary AS previous
    WHERE previous.period_key < NEW.period_key
      AND previous.member_end IS NOT NULL
  )
BEGIN
  UPDATE sh_daily_summary
  SET
    member_start = (
      SELECT previous.member_end
      FROM sh_daily_summary AS previous
      WHERE previous.period_key < NEW.period_key
        AND previous.member_end IS NOT NULL
      ORDER BY previous.period_key DESC
      LIMIT 1
    ),
    member_growth = NEW.member_end - (
      SELECT previous.member_end
      FROM sh_daily_summary AS previous
      WHERE previous.period_key < NEW.period_key
        AND previous.member_end IS NOT NULL
      ORDER BY previous.period_key DESC
      LIMIT 1
    )
  WHERE period_key = NEW.period_key;
END;

CREATE TRIGGER IF NOT EXISTS trg_sh_daily_summary_member_growth_update
AFTER UPDATE OF member_end ON sh_daily_summary
WHEN NEW.member_end IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM sh_daily_summary AS previous
    WHERE previous.period_key < NEW.period_key
      AND previous.member_end IS NOT NULL
  )
BEGIN
  UPDATE sh_daily_summary
  SET
    member_start = (
      SELECT previous.member_end
      FROM sh_daily_summary AS previous
      WHERE previous.period_key < NEW.period_key
        AND previous.member_end IS NOT NULL
      ORDER BY previous.period_key DESC
      LIMIT 1
    ),
    member_growth = NEW.member_end - (
      SELECT previous.member_end
      FROM sh_daily_summary AS previous
      WHERE previous.period_key < NEW.period_key
        AND previous.member_end IS NOT NULL
      ORDER BY previous.period_key DESC
      LIMIT 1
    )
  WHERE period_key = NEW.period_key;
END;
