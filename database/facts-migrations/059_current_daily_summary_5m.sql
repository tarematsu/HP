-- Replace one summary UPDATE per live minute with one five-minute batch write.
-- The raw minute facts remain canonical, so summary precision is unchanged.
DROP TRIGGER IF EXISTS trg_sh_current_daily_summary_insert;
DROP TRIGGER IF EXISTS trg_sh_current_daily_summary_5m_insert;
DROP TRIGGER IF EXISTS trg_sh_current_daily_summary_late_insert;

-- Re-seed today's projection only through the last completed five-minute bucket.
-- This prevents the first post-migration bucket flush from double-counting rows
-- already included by the old per-minute trigger.
DELETE FROM sh_current_daily_summary
WHERE day_at=CAST(unixepoch('now','start of day') AS INTEGER)*1000;

WITH bounds AS (
  SELECT
    CAST(unixepoch('now','start of day') AS INTEGER)*1000 AS day_start,
    CAST((unixepoch()*1000)/300000 AS INTEGER)*300000 AS cutoff
), base AS (
  SELECT f.*
  FROM sh_minute_facts AS f INDEXED BY idx_sh_minute_facts_time,bounds
  WHERE f.source_code=1
    AND f.minute_at>=bounds.day_start
    AND f.minute_at<bounds.cutoff
)
INSERT INTO sh_current_daily_summary(
  channel_id,day_at,period_start,period_end,sample_count,reliable_sample_count,
  listener_sum,listener_min,listener_max,
  stream_start_at,stream_start,stream_end_at,stream_end,
  member_end_at,member_end,updated_at
)
SELECT
  b.channel_id,
  CAST(b.minute_at/86400000 AS INTEGER)*86400000,
  MIN(b.minute_at),MAX(b.minute_at),COUNT(*),COUNT(b.listener_count),
  COALESCE(SUM(b.listener_count),0),MIN(b.listener_count),MAX(b.listener_count),
  MIN(CASE WHEN b.reported_current_stream_count IS NOT NULL THEN b.minute_at END),
  (SELECT s.reported_current_stream_count FROM base AS s
    WHERE s.channel_id=b.channel_id AND s.reported_current_stream_count IS NOT NULL
    ORDER BY s.minute_at ASC,s.id ASC LIMIT 1),
  MAX(CASE WHEN b.reported_current_stream_count IS NOT NULL THEN b.minute_at END),
  (SELECT s.reported_current_stream_count FROM base AS s
    WHERE s.channel_id=b.channel_id AND s.reported_current_stream_count IS NOT NULL
    ORDER BY s.minute_at DESC,s.id DESC LIMIT 1),
  MAX(CASE WHEN b.total_member_count IS NOT NULL THEN b.minute_at END),
  (SELECT m.total_member_count FROM base AS m
    WHERE m.channel_id=b.channel_id AND m.total_member_count IS NOT NULL
    ORDER BY m.minute_at DESC,m.id DESC LIMIT 1),
  MAX(b.received_at)
FROM base AS b
GROUP BY b.channel_id;

-- The first minute of each five-minute bucket flushes the completed previous
-- bucket. At 00:00 this also closes the final bucket of the previous UTC day.
CREATE TRIGGER trg_sh_current_daily_summary_5m_insert
AFTER INSERT ON sh_minute_facts
WHEN NEW.source_code=1 AND NEW.minute_at%300000=0
BEGIN
  INSERT INTO sh_current_daily_summary(
    channel_id,day_at,period_start,period_end,sample_count,reliable_sample_count,
    listener_sum,listener_min,listener_max,
    stream_start_at,stream_start,stream_end_at,stream_end,
    member_end_at,member_end,updated_at
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
    MAX(CASE WHEN f.total_member_count IS NOT NULL THEN f.minute_at END),
    (SELECT m.total_member_count
      FROM sh_minute_facts AS m INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
      WHERE m.source_code=1 AND m.channel_id=NEW.channel_id
        AND m.minute_at>=NEW.minute_at-300000 AND m.minute_at<NEW.minute_at
        AND m.total_member_count IS NOT NULL
      ORDER BY m.minute_at DESC,m.id DESC LIMIT 1),
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
    member_end_at=CASE
      WHEN excluded.member_end_at IS NULL THEN sh_current_daily_summary.member_end_at
      WHEN sh_current_daily_summary.member_end_at IS NULL
        OR excluded.member_end_at>=sh_current_daily_summary.member_end_at THEN excluded.member_end_at
      ELSE sh_current_daily_summary.member_end_at END,
    member_end=CASE
      WHEN excluded.member_end_at IS NULL THEN sh_current_daily_summary.member_end
      WHEN sh_current_daily_summary.member_end_at IS NULL
        OR excluded.member_end_at>=sh_current_daily_summary.member_end_at THEN excluded.member_end
      ELSE sh_current_daily_summary.member_end END,
    updated_at=MAX(sh_current_daily_summary.updated_at,excluded.updated_at);
END;

-- A genuinely late missing fact is uncommon. Apply it individually only inside a
-- two-day repair window; normal ordered ingestion therefore stays at one summary
-- write per five minutes while recent gaps remain self-healing.
CREATE TRIGGER trg_sh_current_daily_summary_late_insert
AFTER INSERT ON sh_minute_facts
WHEN NEW.source_code=1
  AND NEW.minute_at<CAST((unixepoch()*1000)/300000 AS INTEGER)*300000
  AND NEW.minute_at>=unixepoch('now','-2 days')*1000
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
    member_end_at=CASE
      WHEN excluded.member_end_at IS NULL THEN sh_current_daily_summary.member_end_at
      WHEN sh_current_daily_summary.member_end_at IS NULL
        OR excluded.member_end_at>=sh_current_daily_summary.member_end_at THEN excluded.member_end_at
      ELSE sh_current_daily_summary.member_end_at END,
    member_end=CASE
      WHEN excluded.member_end_at IS NULL THEN sh_current_daily_summary.member_end
      WHEN sh_current_daily_summary.member_end_at IS NULL
        OR excluded.member_end_at>=sh_current_daily_summary.member_end_at THEN excluded.member_end
      ELSE sh_current_daily_summary.member_end END,
    updated_at=MAX(sh_current_daily_summary.updated_at,excluded.updated_at);
END;
