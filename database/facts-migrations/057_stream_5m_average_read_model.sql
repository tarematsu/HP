-- Replace the per-minute intermediate model with the final five-minute average
-- consumed by Pages. Buckets keep the valid minute deltas that are available;
-- missing minutes and counter resets are not converted into synthetic zeroes.
CREATE TABLE IF NOT EXISTS sh_stream_5m_average_read_model (
  channel_id INTEGER NOT NULL,
  bucket_at INTEGER NOT NULL,
  stream_delta_avg REAL NOT NULL,
  sample_count INTEGER NOT NULL,
  PRIMARY KEY(channel_id, bucket_at)
) WITHOUT ROWID;

-- Rebuild the bounded recent window directly from canonical minute facts. This
-- also makes this changed migration safe to re-apply after the retired one-minute
-- intermediate table has already been dropped in production.
WITH latest_channel AS (
  SELECT channel_id
  FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_live_minute
  WHERE source_code=1
  ORDER BY minute_at DESC,id DESC
  LIMIT 1
)
INSERT INTO sh_stream_5m_average_read_model(
  channel_id,bucket_at,stream_delta_avg,sample_count
)
SELECT
  f.channel_id,
  (f.minute_at/300000)*300000 AS bucket_at,
  AVG(f.reported_current_stream_count-p.reported_current_stream_count) AS stream_delta_avg,
  COUNT(*) AS sample_count
FROM sh_minute_facts AS f
JOIN sh_minute_facts AS p
  ON p.channel_id=f.channel_id
 AND p.minute_at=f.minute_at-60000
 AND p.source_code=1
WHERE f.source_code=1
  AND f.channel_id=(SELECT channel_id FROM latest_channel)
  AND f.minute_at>=unixepoch('now','-26 hours')*1000
  AND f.reported_current_stream_count IS NOT NULL
  AND p.reported_current_stream_count IS NOT NULL
  AND f.reported_current_stream_count>=p.reported_current_stream_count
GROUP BY f.channel_id,(f.minute_at/300000)*300000
HAVING COUNT(*)>=1
ON CONFLICT(channel_id,bucket_at) DO UPDATE SET
  stream_delta_avg=excluded.stream_delta_avg,
  sample_count=excluded.sample_count
WHERE excluded.stream_delta_avg IS NOT sh_stream_5m_average_read_model.stream_delta_avg
   OR excluded.sample_count IS NOT sh_stream_5m_average_read_model.sample_count;

DROP TRIGGER IF EXISTS trg_sh_stream_minute_delta_after_insert;
DROP TRIGGER IF EXISTS trg_sh_stream_minute_delta_after_update;
DROP TABLE IF EXISTS sh_stream_minute_delta_read_model;
DROP TRIGGER IF EXISTS trg_sh_stream_5m_average_after_insert;
DROP TRIGGER IF EXISTS trg_sh_stream_5m_average_after_update;

CREATE TRIGGER trg_sh_stream_5m_average_after_insert
AFTER INSERT ON sh_minute_facts
WHEN NEW.source_code=1
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

  -- The last minute of a bucket is also the predecessor of the first delta in
  -- the following bucket. Repair that bucket when it already has valid data.
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
