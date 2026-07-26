CREATE TABLE IF NOT EXISTS sh_period_boundary_evidence (
  mode TEXT NOT NULL CHECK(mode IN ('daily','weekly','monthly')),
  period_key TEXT NOT NULL,
  boundary_name TEXT NOT NULL CHECK(boundary_name IN ('start','end')),
  target_at INTEGER NOT NULL,
  observed_at INTEGER,
  stream_observed_at INTEGER,
  stream_value INTEGER,
  member_observed_at INTEGER,
  member_value INTEGER,
  source_id INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (mode, period_key, boundary_name)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_sh_period_boundary_evidence_target
ON sh_period_boundary_evidence(mode, target_at, boundary_name);
