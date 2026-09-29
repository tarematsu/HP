-- Keep exactly one canonical compact owner for member boundaries.
-- sh_total_member_daily owns daily member values. sh_current_daily_summary is a
-- hot projection for listener/stream metrics only; its legacy member columns are
-- retained as nullable compatibility columns but are no longer populated.

DROP TRIGGER IF EXISTS trg_sh_current_daily_summary_insert;
DROP TRIGGER IF EXISTS trg_sh_current_daily_summary_update;
DROP TRIGGER IF EXISTS trg_sh_current_daily_summary_5m_insert;
DROP TRIGGER IF EXISTS trg_sh_current_daily_summary_late_insert;

UPDATE sh_current_daily_summary
SET member_end_at=NULL,member_end=NULL
WHERE member_end_at IS NOT NULL OR member_end IS NOT NULL;

-- Preserve the five-minute batching introduced by migration 059, excluding the
-- duplicated member boundary fields.
CREATE TRIGGER trg_sh_current_daily_summary_5m_insert
AFTER INSERT ON sh_minute_facts
WHEN NEW.source_code=1 AND NEW.minute_at%300000=0
BEGIN
  INSERT INTO sh_current_daily_summary(
    channel_id,day_at,period_start,period_end,sample_count,reliable_sample_count,
    listener_sum,listener_min,listener_max,
    stream_start_at,stream_start,stream_end_at,stream_end,updated_at
  )
  SELECT
    NEW.channel_id,
    CAST((NEW.minute_at-1)/86400000 AS INTEGER)*86400000,
    MIN(f.minute_at),MAX(f.minute_at),COUNT(*),COUNT(f.listener_count),
    COALESCE(SUM(f.listener_count),0),MIN(f.listener_count),MAX(f.listener_count),
    MIN(CASE WHEN f.reported_current_stream_count IS NOT NULL THEN f.minute_at END),
    (SELECT s.reported_current_stream_count
      FROM sh_minute_facts AS s INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
      WHERE s.source_code=1 AND s.channel_id=NEW.channel_id
        AND s.minute_at>=NEW.minute_at-300000 AND s.minute_at<NEW.minute_at
        AND s.reported_current_stream_count IS NOT NULL
      ORDER BY s.minute_at ASC,s.id ASC LIMIT 1),
    MAX(CASE WHEN f.reported_current_stream_count IS NOT NULL THEN f.minute_at END),
    (SELECT s.reported_current_stream_count
      FROM sh_minute_facts AS s INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
      WHERE s.source_code=1 AND s.channel_id=NEW.channel_id
        AND s.minute_at>=NEW.minute_at-300000 AND s.minute_at<NEW.minute_at
        AND s.reported_current_stream_count IS NOT NULL
      ORDER BY s.minute_at DESC,s.id DESC LIMIT 1),
    MAX(f.received_at)
  FROM sh_minute_facts AS f INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
  WHERE f.source_code=1 AND f.channel_id=NEW.channel_id
    AND f.minute_at>=NEW.minute_at-300000 AND f.minute_at<NEW.minute_at
  HAVING COUNT(*)>0
  ON CONFLICT(channel_id,day_at) DO UPDATE SET
    period_start=MIN(sh_current_daily_summary.period_start,excluded.period_start),
    period_end=MAX(sh_current_daily_summary.period_end,excluded.period_end),
    sample_count=sh_current_daily_summary.sample_count+excluded.sample_count,
    reliable_sample_count=sh_current_daily_summary.reliable_sample_count+excluded.reliable_sample_count,
    listener_sum=sh_current_daily_summary.listener_sum+excluded.listener_sum,
    listener_min=CASE
      WHEN excluded.listener_min IS NULL THEN sh_current_daily_summary.listener_min
      WHEN sh_current_daily_summary.listener_min IS NULL THEN excluded.listener_min
      ELSE MIN(sh_current_daily_summary.listener_min,excluded.listener_min)
    END,
    listener_max=CASE
      WHEN excluded.listener_max IS NULL THEN sh_current_daily_summary.listener_max
      WHEN sh_current_daily_summary.listener_max IS NULL THEN excluded.listener_max
      ELSE MAX(sh_current_daily_summary.listener_max,excluded.listener_max)
    END,
    stream_start_at=CASE
      WHEN excluded.stream_start_at IS NULL THEN sh_current_daily_summary.stream_start_at
      WHEN sh_current_daily_summary.stream_start_at IS NULL
        OR excluded.stream_start_at<sh_current_daily_summary.stream_start_at THEN excluded.stream_start_at
      ELSE sh_current_daily_summary.stream_start_at END,
    stream_start=CASE
      WHEN excluded.stream_start_at IS NULL THEN sh_current_daily_summary.stream_start
      WHEN sh_current_daily_summary.stream_start_at IS NULL
        OR excluded.stream_start_at<sh_current_daily_summary.stream_start_at THEN excluded.stream_start
      ELSE sh_current_daily_summary.stream_start END,
    stream_end_at=CASE
      WHEN excluded.stream_end_at IS NULL THEN sh_current_daily_summary.stream_end_at
      WHEN sh_current_daily_summary.stream_end_at IS NULL
        OR excluded.stream_end_at>=sh_current_daily_summary.stream_end_at THEN excluded.stream_end_at
      ELSE sh_current_daily_summary.stream_end_at END,
    stream_end=CASE
      WHEN excluded.stream_end_at IS NULL THEN sh_current_daily_summary.stream_end
      WHEN sh_current_daily_summary.stream_end_at IS NULL
        OR excluded.stream_end_at>=sh_current_daily_summary.stream_end_at THEN excluded.stream_end
      ELSE sh_current_daily_summary.stream_end END,
    updated_at=MAX(sh_current_daily_summary.updated_at,excluded.updated_at);
END;

-- Preserve recent late-fact self-healing without copying member state.
CREATE TRIGGER trg_sh_current_daily_summary_late_insert
AFTER INSERT ON sh_minute_facts
WHEN NEW.source_code=1
  AND NEW.minute_at<CAST((unixepoch()*1000)/300000 AS INTEGER)*300000
  AND NEW.minute_at>=unixepoch('now','-2 days')*1000
BEGIN
  INSERT INTO sh_current_daily_summary(
    channel_id,day_at,period_start,period_end,sample_count,reliable_sample_count,
    listener_sum,listener_min,listener_max,
    stream_start_at,stream_start,stream_end_at,stream_end,updated_at
  ) VALUES(
    NEW.channel_id,
    CAST(NEW.minute_at/86400000 AS INTEGER)*86400000,
    NEW.minute_at,NEW.minute_at,1,
    CASE WHEN NEW.listener_count IS NULL THEN 0 ELSE 1 END,
    COALESCE(NEW.listener_count,0),NEW.listener_count,NEW.listener_count,
    CASE WHEN NEW.reported_current_stream_count IS NULL THEN NULL ELSE NEW.minute_at END,
    NEW.reported_current_stream_count,
    CASE WHEN NEW.reported_current_stream_count IS NULL THEN NULL ELSE NEW.minute_at END,
    NEW.reported_current_stream_count,
    MAX(NEW.observed_at,NEW.received_at)
  )
  ON CONFLICT(channel_id,day_at) DO UPDATE SET
    period_start=MIN(sh_current_daily_summary.period_start,excluded.period_start),
    period_end=MAX(sh_current_daily_summary.period_end,excluded.period_end),
    sample_count=sh_current_daily_summary.sample_count+1,
    reliable_sample_count=sh_current_daily_summary.reliable_sample_count
      +CASE WHEN excluded.listener_min IS NULL THEN 0 ELSE 1 END,
    listener_sum=sh_current_daily_summary.listener_sum+COALESCE(excluded.listener_min,0),
    listener_min=CASE
      WHEN excluded.listener_min IS NULL THEN sh_current_daily_summary.listener_min
      WHEN sh_current_daily_summary.listener_min IS NULL THEN excluded.listener_min
      ELSE MIN(sh_current_daily_summary.listener_min,excluded.listener_min) END,
    listener_max=CASE
      WHEN excluded.listener_max IS NULL THEN sh_current_daily_summary.listener_max
      WHEN sh_current_daily_summary.listener_max IS NULL THEN excluded.listener_max
      ELSE MAX(sh_current_daily_summary.listener_max,excluded.listener_max) END,
    stream_start_at=CASE
      WHEN excluded.stream_start_at IS NULL THEN sh_current_daily_summary.stream_start_at
      WHEN sh_current_daily_summary.stream_start_at IS NULL
        OR excluded.stream_start_at<sh_current_daily_summary.stream_start_at THEN excluded.stream_start_at
      ELSE sh_current_daily_summary.stream_start_at END,
    stream_start=CASE
      WHEN excluded.stream_start_at IS NULL THEN sh_current_daily_summary.stream_start
      WHEN sh_current_daily_summary.stream_start_at IS NULL
        OR excluded.stream_start_at<sh_current_daily_summary.stream_start_at THEN excluded.stream_start
      ELSE sh_current_daily_summary.stream_start END,
    stream_end_at=CASE
      WHEN excluded.stream_end_at IS NULL THEN sh_current_daily_summary.stream_end_at
      WHEN sh_current_daily_summary.stream_end_at IS NULL
        OR excluded.stream_end_at>=sh_current_daily_summary.stream_end_at THEN excluded.stream_end_at
      ELSE sh_current_daily_summary.stream_end_at END,
    stream_end=CASE
      WHEN excluded.stream_end_at IS NULL THEN sh_current_daily_summary.stream_end
      WHEN sh_current_daily_summary.stream_end_at IS NULL
        OR excluded.stream_end_at>=sh_current_daily_summary.stream_end_at THEN excluded.stream_end
      ELSE sh_current_daily_summary.stream_end END,
    updated_at=MAX(sh_current_daily_summary.updated_at,excluded.updated_at);
END;

-- Keep same-minute listener/stream corrections working, but remove member data
-- from the trigger contract. This preserves migration 052 behavior for the two
-- metrics that still belong to this projection.
CREATE TRIGGER trg_sh_current_daily_summary_update
AFTER UPDATE OF listener_count,reported_current_stream_count,observed_at,received_at
ON sh_minute_facts
WHEN OLD.source_code=1 AND NEW.source_code=1
  AND OLD.channel_id=NEW.channel_id AND OLD.minute_at=NEW.minute_at
BEGIN
  UPDATE sh_current_daily_summary SET
    reliable_sample_count=MAX(0,reliable_sample_count
      -CASE WHEN OLD.listener_count IS NULL THEN 0 ELSE 1 END
      +CASE WHEN NEW.listener_count IS NULL THEN 0 ELSE 1 END),
    listener_sum=listener_sum-COALESCE(OLD.listener_count,0)+COALESCE(NEW.listener_count,0),
    listener_min=CASE
      WHEN OLD.listener_count IS NEW.listener_count THEN listener_min
      WHEN OLD.listener_count IS NOT NULL AND OLD.listener_count=listener_min
        AND (NEW.listener_count IS NULL OR NEW.listener_count>OLD.listener_count)
        THEN (SELECT MIN(f.listener_count)
          FROM sh_minute_facts AS f INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
          WHERE f.source_code=1 AND f.channel_id=NEW.channel_id
            AND f.minute_at>=CAST(NEW.minute_at/86400000 AS INTEGER)*86400000
            AND f.minute_at<(CAST(NEW.minute_at/86400000 AS INTEGER)+1)*86400000)
      WHEN NEW.listener_count IS NOT NULL AND (listener_min IS NULL OR NEW.listener_count<listener_min)
        THEN NEW.listener_count
      ELSE listener_min
    END,
    listener_max=CASE
      WHEN OLD.listener_count IS NEW.listener_count THEN listener_max
      WHEN OLD.listener_count IS NOT NULL AND OLD.listener_count=listener_max
        AND (NEW.listener_count IS NULL OR NEW.listener_count<OLD.listener_count)
        THEN (SELECT MAX(f.listener_count)
          FROM sh_minute_facts AS f INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
          WHERE f.source_code=1 AND f.channel_id=NEW.channel_id
            AND f.minute_at>=CAST(NEW.minute_at/86400000 AS INTEGER)*86400000
            AND f.minute_at<(CAST(NEW.minute_at/86400000 AS INTEGER)+1)*86400000)
      WHEN NEW.listener_count IS NOT NULL AND (listener_max IS NULL OR NEW.listener_count>listener_max)
        THEN NEW.listener_count
      ELSE listener_max
    END,
    stream_start_at=CASE
      WHEN NEW.reported_current_stream_count IS NOT NULL
        AND (stream_start_at IS NULL OR NEW.minute_at<=stream_start_at) THEN NEW.minute_at
      WHEN NEW.reported_current_stream_count IS NULL AND stream_start_at=NEW.minute_at
        THEN (SELECT f.minute_at FROM sh_minute_facts AS f INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
          WHERE f.source_code=1 AND f.channel_id=NEW.channel_id
            AND f.minute_at>=CAST(NEW.minute_at/86400000 AS INTEGER)*86400000
            AND f.minute_at<(CAST(NEW.minute_at/86400000 AS INTEGER)+1)*86400000
            AND f.reported_current_stream_count IS NOT NULL
          ORDER BY f.minute_at ASC,f.id ASC LIMIT 1)
      ELSE stream_start_at
    END,
    stream_start=CASE
      WHEN NEW.reported_current_stream_count IS NOT NULL AND stream_start_at=NEW.minute_at
        THEN NEW.reported_current_stream_count
      WHEN NEW.reported_current_stream_count IS NULL AND stream_start_at=NEW.minute_at
        THEN (SELECT f.reported_current_stream_count FROM sh_minute_facts AS f INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
          WHERE f.source_code=1 AND f.channel_id=NEW.channel_id
            AND f.minute_at>=CAST(NEW.minute_at/86400000 AS INTEGER)*86400000
            AND f.minute_at<(CAST(NEW.minute_at/86400000 AS INTEGER)+1)*86400000
            AND f.reported_current_stream_count IS NOT NULL
          ORDER BY f.minute_at ASC,f.id ASC LIMIT 1)
      ELSE stream_start
    END,
    stream_end_at=CASE
      WHEN NEW.reported_current_stream_count IS NOT NULL
        AND (stream_end_at IS NULL OR NEW.minute_at>=stream_end_at) THEN NEW.minute_at
      WHEN NEW.reported_current_stream_count IS NULL AND stream_end_at=NEW.minute_at
        THEN (SELECT f.minute_at FROM sh_minute_facts AS f INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
          WHERE f.source_code=1 AND f.channel_id=NEW.channel_id
            AND f.minute_at>=CAST(NEW.minute_at/86400000 AS INTEGER)*86400000
            AND f.minute_at<(CAST(NEW.minute_at/86400000 AS INTEGER)+1)*86400000
            AND f.reported_current_stream_count IS NOT NULL
          ORDER BY f.minute_at DESC,f.id DESC LIMIT 1)
      ELSE stream_end_at
    END,
    stream_end=CASE
      WHEN NEW.reported_current_stream_count IS NOT NULL AND stream_end_at=NEW.minute_at
        THEN NEW.reported_current_stream_count
      WHEN NEW.reported_current_stream_count IS NULL AND stream_end_at=NEW.minute_at
        THEN (SELECT f.reported_current_stream_count FROM sh_minute_facts AS f INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
          WHERE f.source_code=1 AND f.channel_id=NEW.channel_id
            AND f.minute_at>=CAST(NEW.minute_at/86400000 AS INTEGER)*86400000
            AND f.minute_at<(CAST(NEW.minute_at/86400000 AS INTEGER)+1)*86400000
            AND f.reported_current_stream_count IS NOT NULL
          ORDER BY f.minute_at DESC,f.id DESC LIMIT 1)
      ELSE stream_end
    END,
    updated_at=MAX(updated_at,NEW.observed_at,NEW.received_at)
  WHERE channel_id=NEW.channel_id
    AND day_at=CAST(NEW.minute_at/86400000 AS INTEGER)*86400000;
END;

ANALYZE sh_current_daily_summary;
PRAGMA optimize;
