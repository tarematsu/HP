-- Normal live ingestion finalizes each five-minute stream-average bucket once,
-- at the first minute of the following bucket. Late inserts and corrections keep
-- a targeted repair path so normal writes do not repeatedly rescan the same rows.

DROP TRIGGER IF EXISTS trg_sh_stream_5m_average_after_insert;
DROP TRIGGER IF EXISTS trg_sh_stream_5m_average_after_update;
DROP TRIGGER IF EXISTS trg_sh_stream_5m_average_late_insert;
DROP TRIGGER IF EXISTS trg_sh_stream_5m_average_boundary_insert;

CREATE TRIGGER trg_sh_stream_5m_average_boundary_insert
AFTER INSERT ON sh_minute_facts
WHEN NEW.source_code=1 AND NEW.minute_at%300000=0
BEGIN
  INSERT INTO sh_stream_5m_average_read_model(
    channel_id,bucket_at,stream_delta_avg,sample_count
  )
  SELECT
    NEW.channel_id,
    NEW.minute_at-300000,
    AVG(f.reported_current_stream_count-p.reported_current_stream_count),
    COUNT(*)
  FROM sh_minute_facts AS f
  JOIN sh_minute_facts AS p
    ON p.channel_id=f.channel_id
   AND p.minute_at=f.minute_at-60000
   AND p.source_code=1
  WHERE f.source_code=1
    AND f.channel_id=NEW.channel_id
    AND f.minute_at>=NEW.minute_at-300000
    AND f.minute_at<NEW.minute_at
    AND f.reported_current_stream_count IS NOT NULL
    AND p.reported_current_stream_count IS NOT NULL
    AND f.reported_current_stream_count>=p.reported_current_stream_count
  HAVING COUNT(*)>=1
  ON CONFLICT(channel_id,bucket_at) DO UPDATE SET
    stream_delta_avg=excluded.stream_delta_avg,
    sample_count=excluded.sample_count
  WHERE excluded.stream_delta_avg IS NOT sh_stream_5m_average_read_model.stream_delta_avg
     OR excluded.sample_count IS NOT sh_stream_5m_average_read_model.sample_count;
END;

-- Delayed facts are rare. Recompute only their completed bucket. observed_at is
-- normally close to minute_at, so this path is skipped by ordered live ingestion.
CREATE TRIGGER trg_sh_stream_5m_average_late_insert
AFTER INSERT ON sh_minute_facts
WHEN NEW.source_code=1 AND NEW.observed_at-NEW.minute_at>=300000
BEGIN
  INSERT INTO sh_stream_5m_average_read_model(
    channel_id,bucket_at,stream_delta_avg,sample_count
  )
  SELECT
    NEW.channel_id,
    (NEW.minute_at/300000)*300000,
    AVG(f.reported_current_stream_count-p.reported_current_stream_count),
    COUNT(*)
  FROM sh_minute_facts AS f
  JOIN sh_minute_facts AS p
    ON p.channel_id=f.channel_id
   AND p.minute_at=f.minute_at-60000
   AND p.source_code=1
  WHERE f.source_code=1
    AND f.channel_id=NEW.channel_id
    AND f.minute_at>=(NEW.minute_at/300000)*300000
    AND f.minute_at<(NEW.minute_at/300000)*300000+300000
    AND f.reported_current_stream_count IS NOT NULL
    AND p.reported_current_stream_count IS NOT NULL
    AND f.reported_current_stream_count>=p.reported_current_stream_count
  HAVING COUNT(*)>=1
  ON CONFLICT(channel_id,bucket_at) DO UPDATE SET
    stream_delta_avg=excluded.stream_delta_avg,
    sample_count=excluded.sample_count
  WHERE excluded.stream_delta_avg IS NOT sh_stream_5m_average_read_model.stream_delta_avg
     OR excluded.sample_count IS NOT sh_stream_5m_average_read_model.sample_count;

  INSERT INTO sh_stream_5m_average_read_model(
    channel_id,bucket_at,stream_delta_avg,sample_count
  )
  SELECT
    NEW.channel_id,
    ((NEW.minute_at/300000)*300000)+300000,
    AVG(f.reported_current_stream_count-p.reported_current_stream_count),
    COUNT(*)
  FROM sh_minute_facts AS f
  JOIN sh_minute_facts AS p
    ON p.channel_id=f.channel_id
   AND p.minute_at=f.minute_at-60000
   AND p.source_code=1
  WHERE NEW.minute_at%300000=240000
    AND f.source_code=1
    AND f.channel_id=NEW.channel_id
    AND f.minute_at>=((NEW.minute_at/300000)*300000)+300000
    AND f.minute_at<((NEW.minute_at/300000)*300000)+600000
    AND f.reported_current_stream_count IS NOT NULL
    AND p.reported_current_stream_count IS NOT NULL
    AND f.reported_current_stream_count>=p.reported_current_stream_count
  HAVING COUNT(*)>=1
  ON CONFLICT(channel_id,bucket_at) DO UPDATE SET
    stream_delta_avg=excluded.stream_delta_avg,
    sample_count=excluded.sample_count
  WHERE excluded.stream_delta_avg IS NOT sh_stream_5m_average_read_model.stream_delta_avg
     OR excluded.sample_count IS NOT sh_stream_5m_average_read_model.sample_count;
END;

CREATE TRIGGER trg_sh_stream_5m_average_after_update
AFTER UPDATE OF source_code,reported_current_stream_count ON sh_minute_facts
WHEN (OLD.source_code=1 OR NEW.source_code=1)
  AND (
    OLD.source_code IS NOT NEW.source_code
    OR OLD.reported_current_stream_count IS NOT NEW.reported_current_stream_count
  )
BEGIN
  INSERT INTO sh_stream_5m_average_read_model(
    channel_id,bucket_at,stream_delta_avg,sample_count
  )
  SELECT
    NEW.channel_id,
    (NEW.minute_at/300000)*300000,
    AVG(f.reported_current_stream_count-p.reported_current_stream_count),
    COUNT(*)
  FROM sh_minute_facts AS f
  JOIN sh_minute_facts AS p
    ON p.channel_id=f.channel_id
   AND p.minute_at=f.minute_at-60000
   AND p.source_code=1
  WHERE f.source_code=1
    AND f.channel_id=NEW.channel_id
    AND f.minute_at>=(NEW.minute_at/300000)*300000
    AND f.minute_at<(NEW.minute_at/300000)*300000+300000
    AND f.reported_current_stream_count IS NOT NULL
    AND p.reported_current_stream_count IS NOT NULL
    AND f.reported_current_stream_count>=p.reported_current_stream_count
  HAVING COUNT(*)>=1
  ON CONFLICT(channel_id,bucket_at) DO UPDATE SET
    stream_delta_avg=excluded.stream_delta_avg,
    sample_count=excluded.sample_count
  WHERE excluded.stream_delta_avg IS NOT sh_stream_5m_average_read_model.stream_delta_avg
     OR excluded.sample_count IS NOT sh_stream_5m_average_read_model.sample_count;

  DELETE FROM sh_stream_5m_average_read_model
  WHERE channel_id=NEW.channel_id
    AND bucket_at=(NEW.minute_at/300000)*300000
    AND NOT EXISTS (
      SELECT 1
      FROM sh_minute_facts AS f
      JOIN sh_minute_facts AS p
        ON p.channel_id=f.channel_id
       AND p.minute_at=f.minute_at-60000
       AND p.source_code=1
      WHERE f.source_code=1
        AND f.channel_id=NEW.channel_id
        AND f.minute_at>=(NEW.minute_at/300000)*300000
        AND f.minute_at<(NEW.minute_at/300000)*300000+300000
        AND f.reported_current_stream_count IS NOT NULL
        AND p.reported_current_stream_count IS NOT NULL
        AND f.reported_current_stream_count>=p.reported_current_stream_count
    );

  INSERT INTO sh_stream_5m_average_read_model(
    channel_id,bucket_at,stream_delta_avg,sample_count
  )
  SELECT
    NEW.channel_id,
    ((NEW.minute_at/300000)*300000)+300000,
    AVG(f.reported_current_stream_count-p.reported_current_stream_count),
    COUNT(*)
  FROM sh_minute_facts AS f
  JOIN sh_minute_facts AS p
    ON p.channel_id=f.channel_id
   AND p.minute_at=f.minute_at-60000
   AND p.source_code=1
  WHERE NEW.minute_at%300000=240000
    AND f.source_code=1
    AND f.channel_id=NEW.channel_id
    AND f.minute_at>=((NEW.minute_at/300000)*300000)+300000
    AND f.minute_at<((NEW.minute_at/300000)*300000)+600000
    AND f.reported_current_stream_count IS NOT NULL
    AND p.reported_current_stream_count IS NOT NULL
    AND f.reported_current_stream_count>=p.reported_current_stream_count
  HAVING COUNT(*)>=1
  ON CONFLICT(channel_id,bucket_at) DO UPDATE SET
    stream_delta_avg=excluded.stream_delta_avg,
    sample_count=excluded.sample_count
  WHERE excluded.stream_delta_avg IS NOT sh_stream_5m_average_read_model.stream_delta_avg
     OR excluded.sample_count IS NOT sh_stream_5m_average_read_model.sample_count;

  DELETE FROM sh_stream_5m_average_read_model
  WHERE channel_id=NEW.channel_id
    AND bucket_at=((NEW.minute_at/300000)*300000)+300000
    AND NEW.minute_at%300000=240000
    AND NOT EXISTS (
      SELECT 1
      FROM sh_minute_facts AS f
      JOIN sh_minute_facts AS p
        ON p.channel_id=f.channel_id
       AND p.minute_at=f.minute_at-60000
       AND p.source_code=1
      WHERE f.source_code=1
        AND f.channel_id=NEW.channel_id
        AND f.minute_at>=((NEW.minute_at/300000)*300000)+300000
        AND f.minute_at<((NEW.minute_at/300000)*300000)+600000
        AND f.reported_current_stream_count IS NOT NULL
        AND p.reported_current_stream_count IS NOT NULL
        AND f.reported_current_stream_count>=p.reported_current_stream_count
    );
END;

PRAGMA optimize;
