export const OTHER_RETIRED_MIGRATIONS = Object.freeze([
  '005_legacy_history_tables.sql',
  '006_legacy_snapshot_stream_count.sql',
]);

export const OTHER_REQUIRED_TABLES = Object.freeze([
  'sh_cloud_host_monitor_state',
  'sh_official_news_monitor_state',
  'sh_official_news_announcements',
  'sh_official_news_station_probes',
  'sh_official_news_comments',
  'sh_host_broadcast_sessions',
  'sh_host_station_snapshots',
  'sh_host_queue_snapshots',
  'sh_host_queue_items',
  'sh_comment_velocity_samples',
  'sh_daily_summary',
  'sh_weekly_summary',
  'sh_monthly_summary',
  'sh_solo_activity_state',
  'sh_solo_activity_minutes',
  'sh_solo_activity_days',
  'sh_worker_collector_state',
  'sh_worker_auth_control',
  'sh_collector_status',
  'sh_official_broadcast_summary',
  'sh_channel_rankings',
]);

export const OTHER_RETIRED_OBJECTS = Object.freeze([
  'sh_stream_goal_prediction_state',
  'sh_ingest_conflicts',
  'sh_ingest_claims',
  'sh_track_metadata',
  'sh_legacy_snapshots',
  'sh_legacy_history_rows',
  'sh_host_comments',
  'sh_host_raw_events',
  'sh_host_profile_snapshots',
  'sh_buddy_playback_pipeline',
  'sh_buddy_playback_clock',
  'sh_buddy_track_metadata',
  'sh_playback_channel_current',
]);
