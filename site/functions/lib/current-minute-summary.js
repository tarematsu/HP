// Current-day history must follow the fact's canonical minute, not the time a
// historical/backfill row happened to be received. Using observed_at here can
// classify millions of old minutes as "today" during a repair import.
//
// Keep the current daily series on the same active channel as the dashboard.
// Minute Facts are unique by (channel_id, minute_at), so this also preserves the
// invariant that one channel can contribute at most 1,440 samples to a UTC day.
export const CURRENT_DAILY_MINUTE_SUMMARY_SQL = `WITH latest_channel AS (
  SELECT channel_id
  FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_live_minute
  WHERE source_code=1
  ORDER BY minute_at DESC,id DESC
  LIMIT 1
), prepared AS (
  SELECT f.id AS id,
    f.minute_at AS observed_at,
    f.listener_count AS listener_count,
    COALESCE(d.last_total_member_count,f.total_member_count) AS total_member_count,
    f.reported_current_stream_count AS stream_value,
    h.current_handle AS host_handle,
    strftime('%Y-%m-%d',f.minute_at/1000,'unixepoch') AS period_key
  FROM sh_minute_facts f INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
  LEFT JOIN sh_minute_fact_context_v2 c ON c.fact_id=f.id
  LEFT JOIN sh_broadcast_sessions s ON s.id=f.broadcast_session_id
  LEFT JOIN sh_hosts h ON h.id=COALESCE(c.host_id_override,s.host_id)
  LEFT JOIN sh_total_member_daily_latest d
    ON d.channel_id=f.channel_id
    AND d.day_at=(f.minute_at/86400000)*86400000
  WHERE f.source_code=1
    AND f.channel_id=(SELECT channel_id FROM latest_channel)
    AND f.minute_at>=? AND f.minute_at<?
), ranked AS (
  SELECT prepared.*,
    ROW_NUMBER() OVER (
      PARTITION BY period_key
      ORDER BY (stream_value IS NULL) ASC,observed_at ASC,id ASC
    ) AS stream_first_rank,
    ROW_NUMBER() OVER (
      PARTITION BY period_key
      ORDER BY (stream_value IS NULL) ASC,observed_at DESC,id DESC
    ) AS stream_last_rank,
    ROW_NUMBER() OVER (
      PARTITION BY period_key
      ORDER BY (total_member_count IS NULL) ASC,observed_at ASC,id ASC
    ) AS member_first_rank,
    ROW_NUMBER() OVER (
      PARTITION BY period_key
      ORDER BY (total_member_count IS NULL) ASC,observed_at DESC,id DESC
    ) AS member_last_rank
  FROM prepared
), aggregated AS (
  SELECT period_key,MIN(observed_at) AS period_start,MAX(observed_at) AS period_end,
    COUNT(*) AS sample_count,COUNT(listener_count) AS reliable_sample_count,
    AVG(listener_count) AS listener_avg,
    MIN(listener_count) AS listener_min,MAX(listener_count) AS listener_max,
    MAX(CASE WHEN stream_first_rank=1 THEN stream_value END) AS stream_start,
    MAX(CASE WHEN stream_last_rank=1 THEN stream_value END) AS stream_end,
    MAX(CASE WHEN member_first_rank=1 THEN total_member_count END) AS member_start,
    MAX(CASE WHEN member_last_rank=1 THEN total_member_count END) AS member_end
  FROM ranked GROUP BY period_key
), host_counts AS (
  SELECT period_key,host_handle,COUNT(*) AS host_samples FROM prepared
  WHERE host_handle IS NOT NULL AND host_handle<>'' GROUP BY period_key,host_handle
), primary_hosts AS (
  SELECT period_key,host_handle FROM (
    SELECT period_key,host_handle,ROW_NUMBER() OVER (
      PARTITION BY period_key ORDER BY host_samples DESC,host_handle ASC
    ) AS host_rank FROM host_counts
  ) WHERE host_rank=1
)
SELECT aggregated.period_key,aggregated.period_start,aggregated.period_end,
  aggregated.sample_count,aggregated.reliable_sample_count,
  aggregated.listener_avg,aggregated.listener_min,aggregated.listener_max,
  aggregated.stream_start,aggregated.stream_end,
  aggregated.member_start,aggregated.member_end,
  primary_hosts.host_handle AS primary_host
FROM aggregated LEFT JOIN primary_hosts ON primary_hosts.period_key=aggregated.period_key
ORDER BY aggregated.period_key ASC LIMIT ?`;
