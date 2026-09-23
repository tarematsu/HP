-- Fourth historical leaderboard fandom backfill.
-- Keep uncertain handles unmapped; every row below has public evidence for the supported artist.
INSERT INTO sh_channel_fandoms(
  host_name, artist_name, relation_type, source_url, source_note, verified_at
) VALUES
  ('chillnicoej', '&TEAM', 'fandom', 'https://mobile.twstalker.com/NICHO_EJ', 'Public LUNÉ profile explicitly identifies as an &TEAM fan account and links directly to stationhead.com/chillnicoej.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('enhypenph', 'ENHYPEN', 'fandom', 'https://x.com/EnhypenPH', 'ENHYPEN Philippines public profile explicitly identifies itself as a Philippine fanbase established to support ENHYPEN; the handle matches the Stationhead host case-insensitively.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('jjkmyanmarteam', 'Jung Kook', 'fandom', 'https://www.stationhead.com/jjkmyanmarteam', 'Exact Stationhead host is publicly indexed playing Jung Kook’s “Seven”; the Myanmar team naming identifies a fan-support station rather than an artist-run official account.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('teamrobots', 'SB19', 'fandom', 'https://www.sotwe.com/sb19xrobots?lang=en', 'Team Robometrinatics publicly states its goal is to improve SB19 statistics and publishes a Station link; classified as an SB19 fan-support station.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('w9kjwnttecob7dl', '&TEAM', 'fandom', 'https://www.instalker.org/w9kjWNTtECOb7dL', 'Exact public account links the &TEAM official site, identifies with LUNÉ, discusses streaming, and amplifies &TEAM Stationhead streaming guidance.', CAST(strftime('%s', 'now') AS INTEGER) * 1000)
ON CONFLICT(host_name) DO UPDATE SET
  artist_name = excluded.artist_name,
  relation_type = excluded.relation_type,
  source_url = excluded.source_url,
  source_note = excluded.source_note,
  verified_at = excluded.verified_at;