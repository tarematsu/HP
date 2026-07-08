-- Re-enable the JMA high-resolution precipitation nowcast (rain-cloud) radar job
-- that 202607011200_disable_cloud_radar.sql removed. With no row in `jobs`, the
-- scheduler never runs fetchRadar, so the radar overlay payload (JMA hrpns tiles
-- plus GSI base tiles) is never produced or delivered to devices -- which is why
-- the bundled satellite/white base-map layers keep rendering but the rain-cloud
-- overlay on top never appears. This restores the original seed from 0001_init;
-- next_run_at = 0 makes the scheduler pick it up on its next tick.
INSERT OR IGNORE INTO jobs(name, interval_seconds, next_run_at) VALUES ('radar', 300, 0);
