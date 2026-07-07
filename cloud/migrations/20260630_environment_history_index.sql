CREATE INDEX IF NOT EXISTS idx_environment_samples_device_observed
  ON environment_samples(device_id, observed_at);
