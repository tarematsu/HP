CREATE TABLE IF NOT EXISTS amazon_music_chart_change_events (
  observed_at INTEGER PRIMARY KEY,
  chart_key TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  current_hash TEXT NOT NULL,
  changed_positions INTEGER NOT NULL CHECK(changed_positions >= 0)
);

CREATE INDEX IF NOT EXISTS idx_amazon_music_chart_change_events_chart_time
  ON amazon_music_chart_change_events(chart_key, observed_at DESC);

CREATE TABLE IF NOT EXISTS amazon_music_group_rank_history (
  observed_at INTEGER NOT NULL,
  group_name TEXT NOT NULL CHECK(group_name IN ('櫻坂46', '日向坂46', '乃木坂46')),
  amazon_music_id TEXT NOT NULL,
  track_id INTEGER,
  rank INTEGER CHECK(rank IS NULL OR rank > 0),
  previous_rank INTEGER CHECK(previous_rank IS NULL OR previous_rank > 0),
  change_type TEXT NOT NULL CHECK(change_type IN ('enter', 'move', 'exit')),
  title TEXT,
  artist TEXT,
  PRIMARY KEY(observed_at, amazon_music_id)
);

CREATE INDEX IF NOT EXISTS idx_amazon_music_group_rank_history_group_time
  ON amazon_music_group_rank_history(group_name, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_amazon_music_group_rank_history_track_time
  ON amazon_music_group_rank_history(amazon_music_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_amazon_music_group_rank_history_track_id_time
  ON amazon_music_group_rank_history(track_id, observed_at DESC)
  WHERE track_id IS NOT NULL;
