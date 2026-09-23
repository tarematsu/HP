-- Materialize per-day play totals so public Pages requests never need to
-- json_extract and aggregate the track-history row payloads.
CREATE TABLE IF NOT EXISTS sh_pages_track_history_daily_read_model (
  play_date TEXT PRIMARY KEY,
  play_count INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

INSERT INTO sh_pages_track_history_daily_read_model(play_date,play_count,row_count,updated_at)
SELECT
  play_date,
  COALESCE(SUM(CASE
    WHEN CAST(json_extract(row_json,'$.play_count') AS INTEGER)>0
      THEN CAST(json_extract(row_json,'$.play_count') AS INTEGER)
    ELSE 1
  END),0) AS play_count,
  COUNT(*) AS row_count,
  COALESCE(MAX(updated_at),0) AS updated_at
FROM sh_pages_track_history_read_model
GROUP BY play_date
ON CONFLICT(play_date) DO UPDATE SET
  play_count=excluded.play_count,
  row_count=excluded.row_count,
  updated_at=excluded.updated_at;

DROP TRIGGER IF EXISTS trg_pages_track_history_daily_insert;
CREATE TRIGGER trg_pages_track_history_daily_insert
AFTER INSERT ON sh_pages_track_history_read_model
BEGIN
  INSERT INTO sh_pages_track_history_daily_read_model(play_date,play_count,row_count,updated_at)
  VALUES(
    NEW.play_date,
    CASE WHEN CAST(json_extract(NEW.row_json,'$.play_count') AS INTEGER)>0
      THEN CAST(json_extract(NEW.row_json,'$.play_count') AS INTEGER) ELSE 1 END,
    1,
    NEW.updated_at
  )
  ON CONFLICT(play_date) DO UPDATE SET
    play_count=sh_pages_track_history_daily_read_model.play_count+excluded.play_count,
    row_count=sh_pages_track_history_daily_read_model.row_count+1,
    updated_at=MAX(sh_pages_track_history_daily_read_model.updated_at,excluded.updated_at);
END;

DROP TRIGGER IF EXISTS trg_pages_track_history_daily_delete;
CREATE TRIGGER trg_pages_track_history_daily_delete
AFTER DELETE ON sh_pages_track_history_read_model
BEGIN
  UPDATE sh_pages_track_history_daily_read_model
  SET
    play_count=MAX(0,play_count-(CASE
      WHEN CAST(json_extract(OLD.row_json,'$.play_count') AS INTEGER)>0
        THEN CAST(json_extract(OLD.row_json,'$.play_count') AS INTEGER) ELSE 1 END)),
    row_count=MAX(0,row_count-1),
    updated_at=MAX(updated_at,OLD.updated_at)
  WHERE play_date=OLD.play_date;
  DELETE FROM sh_pages_track_history_daily_read_model
  WHERE play_date=OLD.play_date AND row_count=0;
END;

DROP TRIGGER IF EXISTS trg_pages_track_history_daily_update;
CREATE TRIGGER trg_pages_track_history_daily_update
AFTER UPDATE OF play_date,row_json,updated_at ON sh_pages_track_history_read_model
BEGIN
  UPDATE sh_pages_track_history_daily_read_model
  SET
    play_count=MAX(0,play_count-(CASE
      WHEN CAST(json_extract(OLD.row_json,'$.play_count') AS INTEGER)>0
        THEN CAST(json_extract(OLD.row_json,'$.play_count') AS INTEGER) ELSE 1 END)),
    row_count=MAX(0,row_count-1),
    updated_at=MAX(updated_at,OLD.updated_at)
  WHERE play_date=OLD.play_date;
  DELETE FROM sh_pages_track_history_daily_read_model
  WHERE play_date=OLD.play_date AND row_count=0;

  INSERT INTO sh_pages_track_history_daily_read_model(play_date,play_count,row_count,updated_at)
  VALUES(
    NEW.play_date,
    CASE WHEN CAST(json_extract(NEW.row_json,'$.play_count') AS INTEGER)>0
      THEN CAST(json_extract(NEW.row_json,'$.play_count') AS INTEGER) ELSE 1 END,
    1,
    NEW.updated_at
  )
  ON CONFLICT(play_date) DO UPDATE SET
    play_count=sh_pages_track_history_daily_read_model.play_count+excluded.play_count,
    row_count=sh_pages_track_history_daily_read_model.row_count+1,
    updated_at=MAX(sh_pages_track_history_daily_read_model.updated_at,excluded.updated_at);
END;
