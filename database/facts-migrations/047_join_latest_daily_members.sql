-- Avoid evaluating the daily member lookup once for every minute fact. Summary
-- and period-boundary queries read sh_channel_snapshots over many thousands of
-- facts, so the former correlated subquery multiplied a small daily table scan
-- into millions of billed D1 row reads.

CREATE INDEX IF NOT EXISTS idx_sh_total_member_daily_latest
  ON sh_total_member_daily(
    channel_id,
    day_at,
    last_observed_at DESC,
    host_key,
    last_total_member_count
  );

DROP VIEW IF EXISTS sh_total_member_daily_latest;
CREATE VIEW sh_total_member_daily_latest AS
SELECT channel_id,day_at,last_total_member_count
FROM (
  SELECT channel_id,day_at,last_total_member_count,
    ROW_NUMBER() OVER (
      PARTITION BY channel_id,day_at
      ORDER BY last_observed_at DESC,host_key ASC
    ) AS row_rank
  FROM sh_total_member_daily INDEXED BY idx_sh_total_member_daily_latest
)
WHERE row_rank=1;

DROP VIEW IF EXISTS sh_channel_snapshots;
CREATE VIEW sh_channel_snapshots AS
SELECT f.id,f.observed_at,f.channel_id,NULL AS channel_alias,NULL AS channel_name,
  c.station_id,f.is_broadcasting AS is_launched,f.is_broadcasting,
  NULL AS chat_status,f.listener_count,f.online_member_count,
  COALESCE(d.last_total_member_count,f.total_member_count) AS total_member_count,
  f.guest_count,f.reported_total_listens AS total_listens,NULL AS stream_goal,
  f.reported_current_stream_count AS current_stream_count,
  h.stationhead_account_id AS host_account_id,h.current_handle AS host_handle,
  c.broadcast_start_time,NULL AS raw_json,f.comment_count AS comment_velocity,
  NULL AS validated_stream_count
FROM sh_minute_facts f
LEFT JOIN sh_minute_fact_context c ON c.fact_id=f.id
LEFT JOIN sh_hosts h ON h.id=c.host_id
LEFT JOIN sh_total_member_daily_latest d
  ON d.channel_id=f.channel_id
  AND d.day_at=(f.observed_at/86400000)*86400000;
