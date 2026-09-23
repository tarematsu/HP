CREATE TABLE IF NOT EXISTS sh_channel_fandoms (
  host_name TEXT PRIMARY KEY COLLATE NOCASE,
  artist_name TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('fandom', 'official')),
  source_url TEXT,
  source_note TEXT,
  verified_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sh_channel_fandoms_artist
  ON sh_channel_fandoms(artist_name, relation_type);

CREATE INDEX IF NOT EXISTS idx_sh_channel_fandoms_host_normalized
  ON sh_channel_fandoms(lower(trim(host_name)));

INSERT INTO sh_channel_fandoms(
  host_name, artist_name, relation_type, source_url, source_note, verified_at
) VALUES
  (
    'sakuramankai',
    '櫻坂46',
    'fandom',
    'https://x.com/skr_Stationhead',
    'BUDDIES STATIONHEAD / unofficial Sakurazaka46 fan channel',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  ),
  (
    'sakurazaka46jp',
    '櫻坂46',
    'official',
    'https://sakurazaka46.com/s/s46/news/detail/R00621?ima=0000',
    'Sakurazaka46 official Stationhead account',
    CAST(strftime('%s', 'now') AS INTEGER) * 1000
  )
ON CONFLICT(host_name) DO UPDATE SET
  artist_name = excluded.artist_name,
  relation_type = excluded.relation_type,
  source_url = excluded.source_url,
  source_note = excluded.source_note,
  verified_at = excluded.verified_at;
