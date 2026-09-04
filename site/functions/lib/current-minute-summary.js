// Current-day history must follow the fact's canonical minute, not the time a
// historical/backfill row happened to be received. Using observed_at here can
// classify millions of old minutes as "today" during a repair import.
//
// Keep the current daily series on the same active channel as the dashboard.
// Minute Facts are unique by (channel_id, minute_at), so one bounded scan can
// contribute at most 1,440 samples. Materialize that scan once and derive the
// aggregate, edge values, and primary host from the temporary result instead of
// re-ranking the D1 rows several times.
export const CURRENT_DAILY_MINUTE_SUMMARY_SQL = `WITH latest_channel AS (
  SELECT channel_id
  FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_live_minute
  WHERE source_code=1
  ORDER BY minute_at DESC,id DESC
  LIMIT 1
), latest_daily_member AS (
  SELECT last_total_member_count
  FROM sh_total_member_daily INDEXED BY idx_sh_total_member_daily_latest
  WHERE channel_id=(SELECT channel_id FROM latest_channel)
    AND day_at=?1
  ORDER BY last_observed_at DESC,host_key ASC
  LIMIT 1
), prepared AS MATERIALIZED (
  SELECT f.id,
    f.minute_at AS observed_at,
    f.listener_count,
    f.total_member_count,
    f.reported_current_stream_count AS stream_value,
    h.current_handle AS host_handle
  FROM sh_minute_facts f INDEXED BY idx_sh_minute_facts_source_channel_minute_desc
  LEFT JOIN sh_minute_fact_context_v2 c ON c.fact_id=f.id
  LEFT JOIN sh_broadcast_sessions s ON s.id=f.broadcast_session_id
  LEFT JOIN sh_hosts h ON h.id=COALESCE(c.host_id_override,s.host_id)
  WHERE f.source_code=1
    AND f.channel_id=(SELECT channel_id FROM latest_channel)
    AND f.minute_at>=?1 AND f.minute_at<?2
), stats AS (
  SELECT MIN(observed_at) AS period_start,MAX(observed_at) AS period_end,
    COUNT(*) AS sample_count,COUNT(listener_count) AS reliable_sample_count,
    AVG(listener_count) AS listener_avg,
    MIN(listener_count) AS listener_min,MAX(listener_count) AS listener_max,
    MIN(CASE WHEN stream_value IS NOT NULL THEN observed_at END) AS stream_start_at,
    MAX(CASE WHEN stream_value IS NOT NULL THEN observed_at END) AS stream_end_at,
    MIN(CASE WHEN total_member_count IS NOT NULL THEN observed_at END) AS member_start_at,
    MAX(CASE WHEN total_member_count IS NOT NULL THEN observed_at END) AS member_end_at
  FROM prepared
), primary_host AS (
  SELECT host_handle
  FROM prepared
  WHERE host_handle IS NOT NULL AND host_handle<>''
  GROUP BY host_handle
  ORDER BY COUNT(*) DESC,host_handle ASC
  LIMIT 1
)
SELECT strftime('%Y-%m-%d',?1/1000,'unixepoch') AS period_key,
  stats.period_start,stats.period_end,stats.sample_count,stats.reliable_sample_count,
  stats.listener_avg,stats.listener_min,stats.listener_max,
  (SELECT stream_value FROM prepared
    WHERE observed_at=stats.stream_start_at LIMIT 1) AS stream_start,
  (SELECT stream_value FROM prepared
    WHERE observed_at=stats.stream_end_at LIMIT 1) AS stream_end,
  COALESCE((SELECT last_total_member_count FROM latest_daily_member),
    (SELECT total_member_count FROM prepared
      WHERE observed_at=stats.member_start_at LIMIT 1)) AS member_start,
  COALESCE((SELECT last_total_member_count FROM latest_daily_member),
    (SELECT total_member_count FROM prepared
      WHERE observed_at=stats.member_end_at LIMIT 1)) AS member_end,
  (SELECT host_handle FROM primary_host) AS primary_host
FROM stats
WHERE stats.sample_count>0
LIMIT ?3`;