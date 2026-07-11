CREATE TABLE IF NOT EXISTS octopus_readings(
  account_number TEXT NOT NULL,
  supply_point TEXT NOT NULL,
  observed_at INTEGER NOT NULL CHECK(observed_at >= 946684800000),
  energy_kwh REAL NOT NULL CHECK(energy_kwh >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(account_number,supply_point,observed_at)
);

CREATE INDEX IF NOT EXISTS idx_octopus_readings_account_time
  ON octopus_readings(account_number,observed_at);

CREATE TABLE IF NOT EXISTS octopus_backfill_state(
  account_number TEXT PRIMARY KEY,
  cursor_before INTEGER NOT NULL,
  consecutive_empty_days INTEGER NOT NULL DEFAULT 0 CHECK(consecutive_empty_days >= 0),
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS octopus_sync_ranges(
  account_number TEXT NOT NULL,
  range_key TEXT NOT NULL,
  from_at INTEGER NOT NULL,
  to_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY(account_number,range_key)
);
