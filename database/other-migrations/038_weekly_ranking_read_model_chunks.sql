CREATE TABLE IF NOT EXISTS sh_weekly_ranking_read_model_chunks (
  generation_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  payload_chunk TEXT NOT NULL,
  refreshed_at INTEGER NOT NULL,
  PRIMARY KEY(generation_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_weekly_ranking_read_model_chunks_refreshed
  ON sh_weekly_ranking_read_model_chunks(refreshed_at);
