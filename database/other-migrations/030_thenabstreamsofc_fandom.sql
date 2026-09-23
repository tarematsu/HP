-- `thenabstreamsofc` is a Thenablovers streaming channel.
-- Thenablovers is the documented fan name for Nabila Taqiyyah.
INSERT INTO sh_channel_fandoms(
  host_name, artist_name, relation_type, source_url, source_note, verified_at
) VALUES (
  'thenabstreamsofc',
  'Nabila Taqiyyah',
  'fandom',
  'https://socialblade.com/instagram/user/thenablovers/realtime',
  'Handle identifies The Nab/Thenablovers; Thenablovers is Nabila Taqiyyah official fanbase name.',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
)
ON CONFLICT(host_name) DO UPDATE SET
  artist_name = excluded.artist_name,
  relation_type = excluded.relation_type,
  source_url = excluded.source_url,
  source_note = excluded.source_note,
  verified_at = excluded.verified_at;
