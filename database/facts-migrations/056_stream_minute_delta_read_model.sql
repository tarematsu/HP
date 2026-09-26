-- Materialize per-minute stream-count deltas at write time so Pages never has to
-- scan 24 hours of minute facts and derive adjacent differences on request.
CREATE TABLE IF NOT EXISTS sh_stream_minute_delta_read_model (
  channel_id INTEGER NOT NULL,
  minute_at INTEGER NOT NULL,
  stream_delta INTEGER,
  PRIMARY KEY(channel_id, minute_at)
) WITHOUT ROWID;

-- Seed only the current channel and a bounded window. The dashboard renders the
-- latest 24 hours, so a 26-hour seed leaves enough preceding context for the
-- first visible minute without turning deployment into a historical rebuild.
WITH latest_channel AS (
  SELECT channel_id
  FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_live_minute
  WHERE source_code=1
  ORDER BY minute_at DESC,id DESC
  LIMIT 1
), windowed AS (
  SELECT
    f.channel_id,
    f.minute_at,
    f.reported_current_stream_count AS stream_count,
    LAG(f.minute_at) OVER (
      PARTITION BY f.channel_id ORDER BY f.minute_at
    ) AS previous_minute_at,
    LAG(f.reported_current_stream_count) OVER (
      PARTITION BY f.channel_id ORDER BY f.minute_at
    ) AS previous_stream_count
  FROM sh_minute_facts AS f INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
  WHERE f.source_code=1
    AND f.channel_id=(SELECT channel_id FROM latest_channel)
    AND f.minute_at>=unixepoch('now','-26 hours')*1000
)
INSERT INTO sh_stream_minute_delta_read_model(
  channel_id,minute_at,stream_delta
)
SELECT
  channel_id,
  minute_at,
  CASE
    WHEN minute_at-previous_minute_at=60000
      AND stream_count IS NOT NULL
      AND previous_stream_count IS NOT NULL
      AND stream_count>=previous_stream_count
    THEN stream_count-previous_stream_count
    ELSE NULL
  END
FROM windowed
WHERE TRUE
ON CONFLICT(channel_id,minute_at) DO UPDATE SET
  stream_delta=excluded.stream_delta
WHERE excluded.stream_delta IS NOT sh_stream_minute_delta_read_model.stream_delta;

-- New canonical facts normally add one read-model row. Recomputing the following
-- minute as well makes late/out-of-order facts repair the dependent delta.
CREATE TRIGGER IF NOT EXISTS trg_sh_stream_minute_delta_after_insert
AFTER INSERT ON sh_minute_facts
WHEN NEW.source_code=1
BEGIN
  INSERT INTO sh_stream_minute_delta_read_model(
    channel_id,minute_at,stream_delta
  )
  SELECT
    f.channel_id,
    f.minute_at,
    CASE
      WHEN p.minute_at IS NOT NULL
        AND f.minute_at-p.minute_at=60000
        AND f.reported_current_stream_count IS NOT NULL
        AND p.reported_current_stream_count IS NOT NULL
        AND f.reported_current_stream_count>=p.reported_current_stream_count
      THEN f.reported_current_stream_count-p.reported_current_stream_count
      ELSE NULL
    END
  FROM sh_minute_facts AS f
  LEFT JOIN sh_minute_facts AS p
    ON p.channel_id=f.channel_id
   AND p.minute_at=f.minute_at-60000
   AND p.source_code=1
  WHERE f.source_code=1
    AND f.channel_id=NEW.channel_id
    AND f.minute_at IN (NEW.minute_at,NEW.minute_at+60000)
  ON CONFLICT(channel_id,minute_at) DO UPDATE SET
    stream_delta=excluded.stream_delta
  WHERE excluded.stream_delta IS NOT sh_stream_minute_delta_read_model.stream_delta;
END;

CREATE TRIGGER IF NOT EXISTS trg_sh_stream_minute_delta_after_update
AFTER UPDATE OF source_code,reported_current_stream_count ON sh_minute_facts
WHEN OLD.source_code=1 OR NEW.source_code=1
BEGIN
  -- If a winner changes away from the live source, remove its own derived row.
  -- The following minute is retained and recomputed below as NULL if its exact
  -- predecessor is no longer eligible.
  DELETE FROM sh_stream_minute_delta_read_model
  WHERE channel_id=NEW.channel_id
    AND minute_at=NEW.minute_at
    AND NOT EXISTS (
      SELECT 1
      FROM sh_minute_facts AS f
      WHERE f.channel_id=NEW.channel_id
        AND f.minute_at=NEW.minute_at
        AND f.source_code=1
    );

  INSERT INTO sh_stream_minute_delta_read_model(
    channel_id,minute_at,stream_delta
  )
  SELECT
    f.channel_id,
    f.minute_at,
    CASE
      WHEN p.minute_at IS NOT NULL
        AND f.minute_at-p.minute_at=60000
        AND f.reported_current_stream_count IS NOT NULL
        AND p.reported_current_stream_count IS NOT NULL
        AND f.reported_current_stream_count>=p.reported_current_stream_count
      THEN f.reported_current_stream_count-p.reported_current_stream_count
      ELSE NULL
    END
  FROM sh_minute_facts AS f
  LEFT JOIN sh_minute_facts AS p
    ON p.channel_id=f.channel_id
   AND p.minute_at=f.minute_at-60000
   AND p.source_code=1
  WHERE f.source_code=1
    AND f.channel_id=NEW.channel_id
    AND f.minute_at IN (NEW.minute_at,NEW.minute_at+60000)
  ON CONFLICT(channel_id,minute_at) DO UPDATE SET
    stream_delta=excluded.stream_delta
  WHERE excluded.stream_delta IS NOT sh_stream_minute_delta_read_model.stream_delta;
END;
