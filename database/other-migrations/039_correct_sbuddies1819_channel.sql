-- Correct the historical leaderboard attribution for sbuddies1819.
-- Stationhead identifies ATIN as the fan channel for SB19; this host is not a Sakurazaka46 host.
UPDATE sh_channel_fandoms
SET artist_name = 'SB19',
    relation_type = 'fandom',
    source_url = 'https://stationhead.com/c/ATIN',
    source_note = 'Stationhead ATIN channel is for SB19; sbuddies1819 is unrelated to Sakurazaka46.',
    verified_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE lower(trim(host_name)) = 'sbuddies1819';
