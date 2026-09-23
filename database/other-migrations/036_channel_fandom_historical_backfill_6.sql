-- Sixth historical leaderboard fandom backfill.
-- Favor exact artist names, verified fandom terminology, or same-handle music activity.
INSERT INTO sh_channel_fandoms(
  host_name, artist_name, relation_type, source_url, source_note, verified_at
) VALUES
  ('onceric', 'TWICE', 'fandom', 'https://volt.fm/user/b7xnywakqdkdh3hm', 'The same Onceric username has a public Spotify-stat profile whose long-term top artist is TWICE and whose top songs/albums are dominated by TWICE and its members; ONCE is also TWICE fandom terminology.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('sbuddies1819', '櫻坂46', 'fandom', 'https://sakurazaka46.com/s/s46/diary/detail/40163', '櫻坂46 official material states that the fan nickname is Buddies. The historical Stationhead host uses the distinctive Buddies support name and is not an official artist handle.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('jo1sup01', 'JO1', 'fandom', 'https://www.stationhead.com/c/jam/shop', 'Stationhead identifies JAM as fans of JO1, while JO1 official material confirms JAM as the JO1 fan name. jo1sup01 is a JO1 support-style host rather than JO1 official.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('busstreamth', 'BUS because of you i shine', 'fandom', 'https://www.busofficialmembership.com/', 'BUS official membership identifies BUS because of you i shine and its BEUS fandom. The historical busstreamth handle is a Thailand streaming-support style host, distinct from the official busofficial Stationhead account.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('hueningkaistudio', 'HUENINGKAI', 'fandom', 'https://weverse.io/txt/highlight?hl=ja', 'TXT official Weverse identifies HUENINGKAI as a TOMORROW X TOGETHER member. The artist-named hueningkaistudio Stationhead handle is fan-operated rather than an official TXT/HUENINGKAI account.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('streamforkarina', 'KARINA', 'fandom', 'https://aespa-official.jp/', 'aespa official profile confirms KARINA. The historical host explicitly says stream for KARINA and is distinct from aespa/KARINA official artist accounts.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('yujiminphoria', 'KARINA', 'fandom', 'https://www.carousell.sg/u/amenter/', 'The same yujiminphoria username appears publicly in aespa/KARINA merchandise activity; Yu Jimin is KARINA’s name, so the historical Stationhead handle is classified as KARINA fandom rather than official.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('iiheartbillie', 'Billie Eilish', 'fandom', 'https://www.stationhead.com/for-fans', 'Stationhead lists Billie Eilish as a dedicated fan-channel artist. The historical iiheartbillie handle explicitly identifies Billie fan support and is not the official billieeilish account.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('kceilish', 'Billie Eilish', 'fandom', 'https://www.stationhead.com/kceilish', 'Stationhead directly resolves the historical kceilish host; the Eilish-named personal host is distinct from Billie Eilish’s official Stationhead artist account and is classified as fandom.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('chillnicoej3', '&TEAM', 'fandom', 'https://mobile.twstalker.com/NICHO_EJ', 'The public NICHO_EJ profile explicitly identifies as &TEAM/LUNÉ and links stationhead.com/chillnicoej. chillnicoej3 is the historical numbered variant of the same distinctive Stationhead host identity.', CAST(strftime('%s', 'now') AS INTEGER) * 1000)
ON CONFLICT(host_name) DO UPDATE SET
  artist_name = excluded.artist_name,
  relation_type = excluded.relation_type,
  source_url = excluded.source_url,
  source_note = excluded.source_note,
  verified_at = excluded.verified_at;