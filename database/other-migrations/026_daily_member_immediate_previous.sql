CREATE TABLE IF NOT EXISTS sh_data_repairs (
  id TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

DROP TRIGGER IF EXISTS trg_sh_daily_summary_member_growth_insert;
DROP TRIGGER IF EXISTS trg_sh_daily_summary_member_growth_update;

UPDATE sh_daily_summary AS current
SET
  member_start = (
    SELECT previous.member_end
    FROM sh_daily_summary AS previous
    WHERE previous.period_key = date(current.period_key, '-1 day')
  ),
  member_growth = CASE
    WHEN current.member_end IS NULL THEN NULL
    WHEN (
      SELECT previous.member_end
      FROM sh_daily_summary AS previous
      WHERE previous.period_key = date(current.period_key, '-1 day')
    ) IS NULL THEN NULL
    ELSE current.member_end - (
      SELECT previous.member_end
      FROM sh_daily_summary AS previous
      WHERE previous.period_key = date(current.period_key, '-1 day')
    )
  END
WHERE current.period_key < strftime('%Y-%m-%d', 'now');

INSERT OR IGNORE INTO sh_data_repairs(id, applied_at)
VALUES('daily-member-growth-v2-immediate-previous', CAST(strftime('%s', 'now') AS INTEGER) * 1000);

CREATE TRIGGER trg_sh_daily_summary_member_growth_insert
AFTER INSERT ON sh_daily_summary
BEGIN
  UPDATE sh_daily_summary
  SET
    member_start = (
      SELECT previous.member_end
      FROM sh_daily_summary AS previous
      WHERE previous.period_key = date(NEW.period_key, '-1 day')
    ),
    member_growth = CASE
      WHEN NEW.member_end IS NULL THEN NULL
      WHEN (
        SELECT previous.member_end
        FROM sh_daily_summary AS previous
        WHERE previous.period_key = date(NEW.period_key, '-1 day')
      ) IS NULL THEN NULL
      ELSE NEW.member_end - (
        SELECT previous.member_end
        FROM sh_daily_summary AS previous
        WHERE previous.period_key = date(NEW.period_key, '-1 day')
      )
    END
  WHERE period_key = NEW.period_key;

  UPDATE sh_daily_summary
  SET
    member_start = NEW.member_end,
    member_growth = CASE
      WHEN member_end IS NULL OR NEW.member_end IS NULL THEN NULL
      ELSE member_end - NEW.member_end
    END
  WHERE period_key = date(NEW.period_key, '+1 day');
END;

CREATE TRIGGER trg_sh_daily_summary_member_growth_update
AFTER UPDATE OF member_end ON sh_daily_summary
BEGIN
  UPDATE sh_daily_summary
  SET
    member_start = (
      SELECT previous.member_end
      FROM sh_daily_summary AS previous
      WHERE previous.period_key = date(NEW.period_key, '-1 day')
    ),
    member_growth = CASE
      WHEN NEW.member_end IS NULL THEN NULL
      WHEN (
        SELECT previous.member_end
        FROM sh_daily_summary AS previous
        WHERE previous.period_key = date(NEW.period_key, '-1 day')
      ) IS NULL THEN NULL
      ELSE NEW.member_end - (
        SELECT previous.member_end
        FROM sh_daily_summary AS previous
        WHERE previous.period_key = date(NEW.period_key, '-1 day')
      )
    END
  WHERE period_key = NEW.period_key;

  UPDATE sh_daily_summary
  SET
    member_start = NEW.member_end,
    member_growth = CASE
      WHEN member_end IS NULL OR NEW.member_end IS NULL THEN NULL
      ELSE member_end - NEW.member_end
    END
  WHERE period_key = date(NEW.period_key, '+1 day');
END;
