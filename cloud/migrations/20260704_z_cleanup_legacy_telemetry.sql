DELETE FROM device_metrics;
DELETE FROM environment_samples;

CREATE TRIGGER IF NOT EXISTS trg_environment_buckets_retention
AFTER INSERT ON environment_buckets
BEGIN
  DELETE FROM environment_buckets
  WHERE bucket_at < NEW.bucket_at - 7776000000;
END;
