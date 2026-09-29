-- One marker per UTC day replaces unconditional day rescans. Normal live inserts
-- hit INSERT OR IGNORE after the first row of the day, so they do not amplify
-- writes. Corrections/deletes to past days advance the revision for race-safe
-- consumption by the materializer.
CREATE TABLE IF NOT EXISTS sh_track_history_dirty_days (
  play_date TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

INSERT OR IGNORE INTO sh_track_history_dirty_days(play_date,revision,updated_at)
VALUES(date('now','-1 day'),1,unixepoch()*1000);

DROP TRIGGER IF EXISTS trg_track_history_dirty_channel_insert;
CREATE TRIGGER trg_track_history_dirty_channel_insert
AFTER INSERT ON sh_channel_snapshots
BEGIN
  INSERT OR IGNORE INTO sh_track_history_dirty_days(play_date,revision,updated_at)
  VALUES(strftime('%Y-%m-%d',NEW.observed_at/1000,'unixepoch'),1,unixepoch()*1000);
END;

DROP TRIGGER IF EXISTS trg_track_history_dirty_queue_snapshot_insert;
CREATE TRIGGER trg_track_history_dirty_queue_snapshot_insert
AFTER INSERT ON sh_queue_snapshots
BEGIN
  INSERT OR IGNORE INTO sh_track_history_dirty_days(play_date,revision,updated_at)
  VALUES(strftime('%Y-%m-%d',NEW.observed_at/1000,'unixepoch'),1,unixepoch()*1000);
END;

DROP TRIGGER IF EXISTS trg_track_history_dirty_queue_item_insert;
CREATE TRIGGER trg_track_history_dirty_queue_item_insert
AFTER INSERT ON sh_queue_items
BEGIN
  INSERT OR IGNORE INTO sh_track_history_dirty_days(play_date,revision,updated_at)
  VALUES(strftime('%Y-%m-%d',NEW.observed_at/1000,'unixepoch'),1,unixepoch()*1000);
END;

DROP TRIGGER IF EXISTS trg_track_history_dirty_channel_update;
CREATE TRIGGER trg_track_history_dirty_channel_update
AFTER UPDATE ON sh_channel_snapshots
BEGIN
  INSERT INTO sh_track_history_dirty_days(play_date,revision,updated_at)
  VALUES(strftime('%Y-%m-%d',NEW.observed_at/1000,'unixepoch'),1,unixepoch()*1000)
  ON CONFLICT(play_date) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at
  WHERE excluded.play_date<date('now');
  INSERT INTO sh_track_history_dirty_days(play_date,revision,updated_at)
  VALUES(strftime('%Y-%m-%d',OLD.observed_at/1000,'unixepoch'),1,unixepoch()*1000)
  ON CONFLICT(play_date) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at
  WHERE excluded.play_date<date('now');
END;

DROP TRIGGER IF EXISTS trg_track_history_dirty_queue_snapshot_update;
CREATE TRIGGER trg_track_history_dirty_queue_snapshot_update
AFTER UPDATE ON sh_queue_snapshots
BEGIN
  INSERT INTO sh_track_history_dirty_days(play_date,revision,updated_at)
  VALUES(strftime('%Y-%m-%d',NEW.observed_at/1000,'unixepoch'),1,unixepoch()*1000)
  ON CONFLICT(play_date) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at
  WHERE excluded.play_date<date('now');
  INSERT INTO sh_track_history_dirty_days(play_date,revision,updated_at)
  VALUES(strftime('%Y-%m-%d',OLD.observed_at/1000,'unixepoch'),1,unixepoch()*1000)
  ON CONFLICT(play_date) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at
  WHERE excluded.play_date<date('now');
END;

DROP TRIGGER IF EXISTS trg_track_history_dirty_queue_item_update;
CREATE TRIGGER trg_track_history_dirty_queue_item_update
AFTER UPDATE ON sh_queue_items
BEGIN
  INSERT INTO sh_track_history_dirty_days(play_date,revision,updated_at)
  VALUES(strftime('%Y-%m-%d',NEW.observed_at/1000,'unixepoch'),1,unixepoch()*1000)
  ON CONFLICT(play_date) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at
  WHERE excluded.play_date<date('now');
  INSERT INTO sh_track_history_dirty_days(play_date,revision,updated_at)
  VALUES(strftime('%Y-%m-%d',OLD.observed_at/1000,'unixepoch'),1,unixepoch()*1000)
  ON CONFLICT(play_date) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at
  WHERE excluded.play_date<date('now');
END;

DROP TRIGGER IF EXISTS trg_track_history_dirty_channel_delete;
CREATE TRIGGER trg_track_history_dirty_channel_delete
AFTER DELETE ON sh_channel_snapshots
BEGIN
  INSERT INTO sh_track_history_dirty_days(play_date,revision,updated_at)
  VALUES(strftime('%Y-%m-%d',OLD.observed_at/1000,'unixepoch'),1,unixepoch()*1000)
  ON CONFLICT(play_date) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;

DROP TRIGGER IF EXISTS trg_track_history_dirty_queue_snapshot_delete;
CREATE TRIGGER trg_track_history_dirty_queue_snapshot_delete
AFTER DELETE ON sh_queue_snapshots
BEGIN
  INSERT INTO sh_track_history_dirty_days(play_date,revision,updated_at)
  VALUES(strftime('%Y-%m-%d',OLD.observed_at/1000,'unixepoch'),1,unixepoch()*1000)
  ON CONFLICT(play_date) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;

DROP TRIGGER IF EXISTS trg_track_history_dirty_queue_item_delete;
CREATE TRIGGER trg_track_history_dirty_queue_item_delete
AFTER DELETE ON sh_queue_items
BEGIN
  INSERT INTO sh_track_history_dirty_days(play_date,revision,updated_at)
  VALUES(strftime('%Y-%m-%d',OLD.observed_at/1000,'unixepoch'),1,unixepoch()*1000)
  ON CONFLICT(play_date) DO UPDATE SET revision=revision+1,updated_at=excluded.updated_at;
END;
