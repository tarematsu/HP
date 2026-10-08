-- Classify nogifan1ch consistently as a Nogizaka fandom account.
INSERT INTO sh_channel_fandoms(
  host_name, artist_name, relation_type, source_url, source_note, verified_at
) VALUES (
  'nogifan1ch',
  '乃木坂46',
  'fandom',
  'https://stationhead.com/nogifan1ch',
  'Nogizaka fandom Stationhead account; affiliation explicitly maintained as Nogizaka.',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
)
ON CONFLICT(host_name) DO UPDATE SET
  artist_name = excluded.artist_name,
  relation_type = excluded.relation_type,
  source_url = excluded.source_url,
  source_note = excluded.source_note,
  verified_at = excluded.verified_at;

UPDATE sh_stationhead_follower_targets
SET source_mask = (source_mask | 8)
WHERE lower(trim(handle)) = 'nogifan1ch';
