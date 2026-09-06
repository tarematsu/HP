-- Split Sakurazaka Stationhead collection into minute-scoped raw storage.
-- Both upstream responses are persisted as unmodified response text. Worker code
-- intentionally does not JSON.parse or JSON.stringify either payload while saving.

CREATE TABLE IF NOT EXISTS sh_sakurazaka46jp_main (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_at INTEGER NOT NULL,
  observed_minute INTEGER NOT NULL UNIQUE,
  buddies_station_id INTEGER,
  station_id INTEGER,
  broadcast_id INTEGER,
  broadcast_start_time INTEGER,
  is_broadcasting INTEGER NOT NULL DEFAULT 0,
  listener_count INTEGER,
  guest_count INTEGER,
  total_listens INTEGER,
  status TEXT,
  chat_status TEXT,
  channel_id INTEGER,
  channel_alias TEXT,
  raw_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sh_sakurazaka46jp_main_observed
ON sh_sakurazaka46jp_main(observed_at);

CREATE TABLE IF NOT EXISTS sh_sakurazaka46jp_chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_at INTEGER NOT NULL,
  observed_minute INTEGER NOT NULL UNIQUE,
  station_id INTEGER,
  raw_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sh_sakurazaka46jp_chat_observed
ON sh_sakurazaka46jp_chat(observed_at);

PRAGMA optimize;
