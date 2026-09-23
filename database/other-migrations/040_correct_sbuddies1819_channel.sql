-- Correct the historical leaderboard attribution for sbuddies1819.
-- Stationhead identifies ATIN as the fan channel for SB19; this host is not a Sakurazaka46 host.
INSERT INTO sh_channel_fandoms(
  host_name, artist_name, relation_type, source_url, source_note, verified_at
) VALUES (
  'sbuddies1819',
  'SB19',
  'fandom',
  'https://stationhead.com/c/ATIN',
  'Stationhead ATIN channel is for SB19; sbuddies1819 is unrelated to Sakurazaka46.',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
)
ON CONFLICT(host_name) DO UPDATE SET
  artist_name = excluded.artist_name,
  relation_type = excluded.relation_type,
  source_url = excluded.source_url,
  source_note = excluded.source_note,
  verified_at = excluded.verified_at;
