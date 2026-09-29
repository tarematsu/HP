-- Compact source-revision rows let Pages decide whether a read model is stale
-- without COUNT/MAX/SUM scans over source tables.
CREATE TABLE IF NOT EXISTS sh_read_model_revision (
  model_key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

INSERT OR IGNORE INTO sh_read_model_revision(model_key,revision,updated_at) VALUES
  ('history:daily',1,unixepoch()*1000),
  ('history:weekly',1,unixepoch()*1000),
  ('history:monthly',1,unixepoch()*1000),
  ('history:broadcasts',1,unixepoch()*1000),
  ('host-history:summary',1,unixepoch()*1000),
  ('weekly-ranking',1,unixepoch()*1000);

DROP TRIGGER IF EXISTS trg_rmrev_daily_insert;
DROP TRIGGER IF EXISTS trg_rmrev_daily_update;
DROP TRIGGER IF EXISTS trg_rmrev_daily_delete;
CREATE TRIGGER trg_rmrev_daily_insert AFTER INSERT ON sh_daily_summary BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:daily',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_daily_update AFTER UPDATE ON sh_daily_summary BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:daily',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_daily_delete AFTER DELETE ON sh_daily_summary BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:daily',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;

DROP TRIGGER IF EXISTS trg_rmrev_weekly_insert;
DROP TRIGGER IF EXISTS trg_rmrev_weekly_update;
DROP TRIGGER IF EXISTS trg_rmrev_weekly_delete;
CREATE TRIGGER trg_rmrev_weekly_insert AFTER INSERT ON sh_weekly_summary BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:weekly',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('weekly-ranking',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_weekly_update AFTER UPDATE ON sh_weekly_summary BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:weekly',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('weekly-ranking',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_weekly_delete AFTER DELETE ON sh_weekly_summary BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:weekly',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('weekly-ranking',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;

DROP TRIGGER IF EXISTS trg_rmrev_monthly_insert;
DROP TRIGGER IF EXISTS trg_rmrev_monthly_update;
DROP TRIGGER IF EXISTS trg_rmrev_monthly_delete;
CREATE TRIGGER trg_rmrev_monthly_insert AFTER INSERT ON sh_monthly_summary BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:monthly',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_monthly_update AFTER UPDATE ON sh_monthly_summary BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:monthly',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_monthly_delete AFTER DELETE ON sh_monthly_summary BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:monthly',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;

DROP TRIGGER IF EXISTS trg_rmrev_broadcast_insert;
DROP TRIGGER IF EXISTS trg_rmrev_broadcast_update;
DROP TRIGGER IF EXISTS trg_rmrev_broadcast_delete;
CREATE TRIGGER trg_rmrev_broadcast_insert AFTER INSERT ON sh_official_broadcast_summary BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:broadcasts',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_broadcast_update AFTER UPDATE ON sh_official_broadcast_summary BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:broadcasts',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_broadcast_delete AFTER DELETE ON sh_official_broadcast_summary BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('history:broadcasts',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;

DROP TRIGGER IF EXISTS trg_rmrev_host_insert;
DROP TRIGGER IF EXISTS trg_rmrev_host_update;
DROP TRIGGER IF EXISTS trg_rmrev_host_delete;
CREATE TRIGGER trg_rmrev_host_insert AFTER INSERT ON sh_host_broadcast_sessions BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('host-history:summary',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_host_update AFTER UPDATE ON sh_host_broadcast_sessions BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('host-history:summary',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_host_delete AFTER DELETE ON sh_host_broadcast_sessions BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('host-history:summary',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;

DROP TRIGGER IF EXISTS trg_rmrev_ranking_insert;
DROP TRIGGER IF EXISTS trg_rmrev_ranking_update;
DROP TRIGGER IF EXISTS trg_rmrev_ranking_delete;
CREATE TRIGGER trg_rmrev_ranking_insert AFTER INSERT ON sh_channel_rankings BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('weekly-ranking',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_ranking_update AFTER UPDATE ON sh_channel_rankings BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('weekly-ranking',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_ranking_delete AFTER DELETE ON sh_channel_rankings BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('weekly-ranking',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;

DROP TRIGGER IF EXISTS trg_rmrev_fandom_insert;
DROP TRIGGER IF EXISTS trg_rmrev_fandom_update;
DROP TRIGGER IF EXISTS trg_rmrev_fandom_delete;
CREATE TRIGGER trg_rmrev_fandom_insert AFTER INSERT ON sh_channel_fandoms BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('weekly-ranking',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_fandom_update AFTER UPDATE ON sh_channel_fandoms BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('weekly-ranking',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
CREATE TRIGGER trg_rmrev_fandom_delete AFTER DELETE ON sh_channel_fandoms BEGIN
  INSERT INTO sh_read_model_revision(model_key,revision,updated_at) VALUES('weekly-ranking',1,unixepoch()*1000)
  ON CONFLICT(model_key) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;