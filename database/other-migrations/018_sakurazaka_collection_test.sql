CREATE TABLE IF NOT EXISTS sh_sakurazaka46jp_collection_tests (
  test_id TEXT PRIMARY KEY,
  target_handle TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sh_sakurazaka46jp_collection_tests_started
  ON sh_sakurazaka46jp_collection_tests(started_at DESC);
