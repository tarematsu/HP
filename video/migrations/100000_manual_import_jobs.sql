CREATE TABLE IF NOT EXISTS manual_import_jobs (
  job_id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  total_urls INTEGER NOT NULL CHECK (total_urls > 20 AND total_urls <= 2000),
  total_chunks INTEGER NOT NULL CHECK (total_chunks > 1),
  next_chunk INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  combined_feed_count INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'finalizing', 'completed', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  last_error TEXT,
  lock_token TEXT,
  lock_until TEXT,
  CHECK (next_chunk >= 0 AND next_chunk <= total_chunks)
);

CREATE TABLE IF NOT EXISTS manual_import_job_chunks (
  job_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  urls_json TEXT NOT NULL CHECK (json_valid(urls_json)),
  url_count INTEGER NOT NULL CHECK (url_count > 0 AND url_count <= 20),
  PRIMARY KEY (job_id, chunk_index),
  FOREIGN KEY (job_id) REFERENCES manual_import_jobs(job_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_manual_import_jobs_queue
  ON manual_import_jobs(status, lock_until, created_at, job_id);
