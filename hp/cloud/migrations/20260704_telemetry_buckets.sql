CREATE TABLE IF NOT EXISTS environment_buckets (
  device_id TEXT NOT NULL,
  bucket_at INTEGER NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  co2_sum REAL NOT NULL DEFAULT 0,
  co2_count INTEGER NOT NULL DEFAULT 0,
  temperature_sum REAL NOT NULL DEFAULT 0,
  temperature_count INTEGER NOT NULL DEFAULT 0,
  humidity_sum REAL NOT NULL DEFAULT 0,
  humidity_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, bucket_at)
);

CREATE INDEX IF NOT EXISTS idx_environment_buckets_device_time
  ON environment_buckets(device_id, bucket_at DESC);

INSERT INTO environment_buckets (
  device_id, bucket_at, sample_count,
  co2_sum, co2_count,
  temperature_sum, temperature_count,
  humidity_sum, humidity_count
)
SELECT
  device_id,
  CAST(observed_at / 300000 AS INTEGER) * 300000,
  COUNT(*),
  COALESCE(SUM(co2), 0), COUNT(co2),
  COALESCE(SUM(COALESCE(temperature_corrected, temperature)), 0),
  COUNT(COALESCE(temperature_corrected, temperature)),
  COALESCE(SUM(COALESCE(humidity_corrected, humidity)), 0),
  COUNT(COALESCE(humidity_corrected, humidity))
FROM environment_samples
GROUP BY device_id, CAST(observed_at / 300000 AS INTEGER)
ON CONFLICT(device_id, bucket_at) DO UPDATE SET
  sample_count = excluded.sample_count,
  co2_sum = excluded.co2_sum,
  co2_count = excluded.co2_count,
  temperature_sum = excluded.temperature_sum,
  temperature_count = excluded.temperature_count,
  humidity_sum = excluded.humidity_sum,
  humidity_count = excluded.humidity_count;

ALTER TABLE device_heartbeats
  ADD COLUMN last_sequence INTEGER NOT NULL DEFAULT 0;

UPDATE device_heartbeats
SET last_sequence = COALESCE((
  SELECT MAX(sequence)
  FROM environment_samples
  WHERE environment_samples.device_id = device_heartbeats.device_id
), 0),
    payload = NULL;
