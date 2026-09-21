-- Keep the current UTC daily summary as a one-row-per-channel projection.
-- Public history-current reads must not rescan up to 1,440 minute facts on every
-- request. New live minute facts update this projection incrementally; the
-- migration seeds today's rows once so deployment starts from a complete state.
CREATE TABLE IF NOT EXISTS sh_current_daily_summary (
  channel_id INTEGER NOT NULL,
  day_at INTEGER NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  reliable_sample_count INTEGER NOT NULL DEFAULT 0,
  listener_sum REAL NOT NULL DEFAULT 0,
  listener_min INTEGER,
  listener_max INTEGER,
  stream_start_at INTEGER,
  stream_start INTEGER,
  stream_end_at INTEGER,
  stream_end INTEGER,
  member_end_at INTEGER,
  member_end INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(channel_id,day_at),
  CHECK(sample_count>=0),
  CHECK(reliable_sample_count>=0 AND reliable_sample_count<=sample_count)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_sh_current_daily_summary_latest
ON sh_current_daily_summary(day_at DESC,period_end DESC,channel_id);

DELETE FROM sh_current_daily_summary
WHERE day_at=CAST(unixepoch('now','start of day') AS INTEGER)*1000;

INSERT INTO sh_current_daily_summary(
  channel_id,day_at,period_start,period_end,sample_count,reliable_sample_count,
  listener_sum,listener_min,listener_max,
  stream_start_at,stream_start,stream_end_at,stream_end,
  member_end_at,member_end,updated_at
)
SELECT
  base.channel_id,
  CAST(base.minute_at/86400000 AS INTEGER)*86400000 AS day_at,
  MIN(base.minute_at),
  MAX(base.minute_at),
  COUNT(*),
  COUNT(base.listener_count),
  COALESCE(SUM(base.listener_count),0),
  MIN(base.listener_count),
  MAX(base.listener_count),
  MIN(CASE WHEN base.reported_current_stream_count IS NOT NULL THEN base.minute_at END),
  (SELECT first_stream.reported_current_stream_count
   FROM sh_minute_facts AS first_stream INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
   WHERE first_stream.source_code=1
     AND first_stream.channel_id=base.channel_id
     AND first_stream.minute_at>=CAST(unixepoch('now','start of day') AS INTEGER)*1000
     AND first_stream.reported_current_stream_count IS NOT NULL
   ORDER BY first_stream.minute_at ASC,first_stream.id ASC LIMIT 1),
  MAX(CASE WHEN base.reported_current_stream_count IS NOT NULL THEN base.minute_at END),
  (SELECT last_stream.reported_current_stream_count
   FROM sh_minute_facts AS last_stream INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
   WHERE last_stream.source_code=1
     AND last_stream.channel_id=base.channel_id
     AND last_stream.minute_at>=CAST(unixepoch('now','start of day') AS INTEGER)*1000
     AND last_stream.reported_current_stream_count IS NOT NULL
   ORDER BY last_stream.minute_at DESC,last_stream.id DESC LIMIT 1),
  MAX(CASE WHEN base.total_member_count IS NOT NULL THEN base.minute_at END),
  (SELECT last_member.total_member_count
   FROM sh_minute_facts AS last_member INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
   WHERE last_member.source_code=1
     AND last_member.channel_id=base.channel_id
     AND last_member.minute_at>=CAST(unixepoch('now','start of day') AS INTEGER)*1000
     AND last_member.total_member_count IS NOT NULL
   ORDER BY last_member.minute_at DESC,last_member.id DESC LIMIT 1),
  MAX(base.received_at)
FROM sh_minute_facts AS base INDEXED BY idx_sh_minute_facts_time
WHERE base.source_code=1
  AND base.minute_at>=CAST(unixepoch('now','start of day') AS INTEGER)*1000
GROUP BY base.channel_id;

DROP TRIGGER IF EXISTS trg_sh_current_daily_summary_insert;
CREATE TRIGGER trg_sh_current_daily_summary_insert
AFTER INSERT ON sh_minute_facts
WHEN NEW.source_code=1
BEGIN
  INSERT INTO sh_current_daily_summary(
    channel_id,day_at,period_start,period_end,sample_count,reliable_sample_count,
    listener_sum,listener_min,listener_max,
    stream_start_at,stream_start,stream_end_at,stream_end,
    member_end_at,member_end,updated_at
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
    CASE WHEN NEW.total_member_count IS NULL THEN NULL ELSE NEW.minute_at END,
    NEW.total_member_count,
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
        OR excluded.stream_start_at<sh_current_daily_summary.stream_start_at
        THEN excluded.stream_start_at
      ELSE sh_current_daily_summary.stream_start_at
    END,
    stream_start=CASE
      WHEN excluded.stream_start_at IS NULL THEN sh_current_daily_summary.stream_start
      WHEN sh_current_daily_summary.stream_start_at IS NULL
        OR excluded.stream_start_at<sh_current_daily_summary.stream_start_at
        THEN excluded.stream_start
      ELSE sh_current_daily_summary.stream_start
    END,
    stream_end_at=CASE
      WHEN excluded.stream_end_at IS NULL THEN sh_current_daily_summary.stream_end_at
      WHEN sh_current_daily_summary.stream_end_at IS NULL
        OR excluded.stream_end_at>=sh_current_daily_summary.stream_end_at
        THEN excluded.stream_end_at
      ELSE sh_current_daily_summary.stream_end_at
    END,
    stream_end=CASE
      WHEN excluded.stream_end_at IS NULL THEN sh_current_daily_summary.stream_end
      WHEN sh_current_daily_summary.stream_end_at IS NULL
        OR excluded.stream_end_at>=sh_current_daily_summary.stream_end_at
        THEN excluded.stream_end
      ELSE sh_current_daily_summary.stream_end
    END,
    member_end_at=CASE
      WHEN excluded.member_end_at IS NULL THEN sh_current_daily_summary.member_end_at
      WHEN sh_current_daily_summary.member_end_at IS NULL
        OR excluded.member_end_at>=sh_current_daily_summary.member_end_at
        THEN excluded.member_end_at
      ELSE sh_current_daily_summary.member_end_at
    END,
    member_end=CASE
      WHEN excluded.member_end_at IS NULL THEN sh_current_daily_summary.member_end
      WHEN sh_current_daily_summary.member_end_at IS NULL
        OR excluded.member_end_at>=sh_current_daily_summary.member_end_at
        THEN excluded.member_end
      ELSE sh_current_daily_summary.member_end
    END,
    updated_at=MAX(sh_current_daily_summary.updated_at,excluded.updated_at);
END;

-- Same-minute live corrections are uncommon, but keep the aggregate exact without
-- rebuilding the whole day. Only an extrema/boundary correction performs a
-- bounded current-day index seek.
DROP TRIGGER IF EXISTS trg_sh_current_daily_summary_update;
CREATE TRIGGER trg_sh_current_daily_summary_update
AFTER UPDATE OF listener_count,reported_current_stream_count,total_member_count,observed_at,received_at
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
    member_end_at=CASE
      WHEN NEW.total_member_count IS NOT NULL
        AND (member_end_at IS NULL OR NEW.minute_at>=member_end_at) THEN NEW.minute_at
      WHEN NEW.total_member_count IS NULL AND member_end_at=NEW.minute_at
        THEN (SELECT f.minute_at FROM sh_minute_facts AS f INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
          WHERE f.source_code=1 AND f.channel_id=NEW.channel_id
            AND f.minute_at>=CAST(NEW.minute_at/86400000 AS INTEGER)*86400000
            AND f.minute_at<(CAST(NEW.minute_at/86400000 AS INTEGER)+1)*86400000
            AND f.total_member_count IS NOT NULL
          ORDER BY f.minute_at DESC,f.id DESC LIMIT 1)
      ELSE member_end_at
    END,
    member_end=CASE
      WHEN NEW.total_member_count IS NOT NULL AND member_end_at=NEW.minute_at THEN NEW.total_member_count
      WHEN NEW.total_member_count IS NULL AND member_end_at=NEW.minute_at
        THEN (SELECT f.total_member_count FROM sh_minute_facts AS f INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
          WHERE f.source_code=1 AND f.channel_id=NEW.channel_id
            AND f.minute_at>=CAST(NEW.minute_at/86400000 AS INTEGER)*86400000
            AND f.minute_at<(CAST(NEW.minute_at/86400000 AS INTEGER)+1)*86400000
            AND f.total_member_count IS NOT NULL
          ORDER BY f.minute_at DESC,f.id DESC LIMIT 1)
      ELSE member_end
    END,
    updated_at=MAX(updated_at,NEW.observed_at,NEW.received_at)
  WHERE channel_id=NEW.channel_id
    AND day_at=CAST(NEW.minute_at/86400000 AS INTEGER)*86400000;
END;

ANALYZE sh_current_daily_summary;
PRAGMA optimize;
