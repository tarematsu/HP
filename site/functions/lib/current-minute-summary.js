// Current-day history is maintained incrementally in sh_current_daily_summary.
// The public/current-history path must read one projection row instead of
// re-aggregating the current UTC day's minute facts for every request.
//
// Member growth remains boundary-to-boundary: the start is the previous UTC
// day's final member value and the end is today's latest daily-member state.
export const CURRENT_DAILY_MINUTE_SUMMARY_SQL = `WITH latest_channel AS (
  SELECT channel_id
  FROM sh_minute_facts INDEXED BY idx_sh_minute_facts_live_minute
  WHERE source_code=1
  ORDER BY minute_at DESC,id DESC
  LIMIT 1
), projection AS (
  SELECT p.*
  FROM sh_current_daily_summary AS p
  WHERE p.channel_id=(SELECT channel_id FROM latest_channel)
    AND p.day_at=?1
    AND p.period_start<?2
  LIMIT 1
), previous_daily_member AS (
  SELECT last_total_member_count
  FROM sh_total_member_daily INDEXED BY idx_sh_total_member_daily_latest
  WHERE channel_id=(SELECT channel_id FROM latest_channel)
    AND day_at=?1-86400000
  ORDER BY last_observed_at DESC,host_key ASC
  LIMIT 1
), latest_daily_member AS (
  SELECT last_total_member_count
  FROM sh_total_member_daily INDEXED BY idx_sh_total_member_daily_latest
  WHERE channel_id=(SELECT channel_id FROM latest_channel)
    AND day_at=?1
  ORDER BY last_observed_at DESC,host_key ASC
  LIMIT 1
)
SELECT strftime('%Y-%m-%d',?1/1000,'unixepoch') AS period_key,
  p.period_start,p.period_end,p.sample_count,p.reliable_sample_count,
  CASE WHEN p.reliable_sample_count>0
    THEN p.listener_sum*1.0/p.reliable_sample_count END AS listener_avg,
  p.listener_min,p.listener_max,
  p.stream_start,p.stream_end,
  (SELECT last_total_member_count FROM previous_daily_member) AS member_start,
  COALESCE((SELECT last_total_member_count FROM latest_daily_member),p.member_end) AS member_end,
  NULL AS primary_host
FROM projection AS p
LIMIT ?3`;