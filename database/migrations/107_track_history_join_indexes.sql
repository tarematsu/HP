CREATE INDEX IF NOT EXISTS idx_sh_queue_snapshots_station_start_observed
ON sh_queue_snapshots(station_id, start_time, observed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_sh_queue_items_station_start_observed
ON sh_queue_items(station_id, start_time, observed_at DESC, position);

CREATE INDEX IF NOT EXISTS idx_sh_channel_snapshots_station_observed
ON sh_channel_snapshots(station_id, observed_at DESC, id DESC);

ANALYZE sh_queue_snapshots;
ANALYZE sh_queue_items;
ANALYZE sh_channel_snapshots;
