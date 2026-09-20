INSERT OR IGNORE INTO sh_official_broadcast_summary (
  host_handle,event_name,started_at,ended_at,started_jst,ended_jst,
  sample_count,listener_avg,listener_max,likes_max,distinct_tracks,refreshed_at
) VALUES (
  'sakurazaka46jp',
  '2026.09.21 『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』',
  1789958700000,
  NULL,
  '2026-09-21 11:45:00',
  NULL,
  0,
  NULL,
  NULL,
  NULL,
  NULL,
  unixepoch('now') * 1000
);
