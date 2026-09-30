-- History read-model revisions should move only when a period visible in the
-- completed-history responses changes. Current daily/weekly/monthly rollups are
-- updated frequently and must not dispatch Pages rebuilds on every maintenance run.

DROP TRIGGER IF EXISTS trg_rmrev_daily_insert;
DROP TRIGGER IF EXISTS trg_rmrev_daily_update;
DROP TRIGGER IF EXISTS trg_rmrev_daily_delete;
CREATE TRIGGER trg_rmrev_daily_insert AFTER INSERT ON sh_daily_summary
WHEN NEW.period_end<=unixepoch()*1000 BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:daily',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_daily_update AFTER UPDATE ON sh_daily_summary
WHEN NEW.period_end<=unixepoch()*1000 BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:daily',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_daily_delete AFTER DELETE ON sh_daily_summary
WHEN OLD.period_end<=unixepoch()*1000 BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:daily',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;

DROP TRIGGER IF EXISTS trg_rmrev_weekly_insert;
DROP TRIGGER IF EXISTS trg_rmrev_weekly_update;
DROP TRIGGER IF EXISTS trg_rmrev_weekly_delete;
DROP TRIGGER IF EXISTS trg_rmrev_weekly_ranking_insert;
DROP TRIGGER IF EXISTS trg_rmrev_weekly_ranking_update;
DROP TRIGGER IF EXISTS trg_rmrev_weekly_ranking_delete;
CREATE TRIGGER trg_rmrev_weekly_insert AFTER INSERT ON sh_weekly_summary
WHEN NEW.period_end<=unixepoch()*1000 BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:weekly',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_weekly_update AFTER UPDATE ON sh_weekly_summary
WHEN NEW.period_end<=unixepoch()*1000 BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:weekly',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_weekly_delete AFTER DELETE ON sh_weekly_summary
WHEN OLD.period_end<=unixepoch()*1000 BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:weekly',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_weekly_ranking_insert AFTER INSERT ON sh_weekly_summary BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('weekly-ranking',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_weekly_ranking_update AFTER UPDATE ON sh_weekly_summary BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('weekly-ranking',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_weekly_ranking_delete AFTER DELETE ON sh_weekly_summary BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('weekly-ranking',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;

DROP TRIGGER IF EXISTS trg_rmrev_monthly_insert;
DROP TRIGGER IF EXISTS trg_rmrev_monthly_update;
DROP TRIGGER IF EXISTS trg_rmrev_monthly_delete;
CREATE TRIGGER trg_rmrev_monthly_insert AFTER INSERT ON sh_monthly_summary
WHEN NEW.period_end<=unixepoch()*1000 BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:monthly',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_monthly_update AFTER UPDATE ON sh_monthly_summary
WHEN NEW.period_end<=unixepoch()*1000 BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:monthly',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_monthly_delete AFTER DELETE ON sh_monthly_summary
WHEN OLD.period_end<=unixepoch()*1000 BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:monthly',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
