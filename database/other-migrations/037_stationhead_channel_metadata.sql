-- Store the Stationhead fan-channel display name separately from the host/station handle.
-- Only channels confirmed from Stationhead pages or public Stationhead channel announcements are seeded.

ALTER TABLE sh_channel_fandoms ADD COLUMN stationhead_channel_name TEXT;
ALTER TABLE sh_channel_fandoms ADD COLUMN stationhead_channel_url TEXT;

UPDATE sh_channel_fandoms
SET stationhead_channel_name = CASE artist_name
  WHEN '櫻坂46' THEN 'Buddies'
  WHEN 'SixTONES' THEN 'team SixTONES'
  WHEN 'BTS' THEN 'BTS ARMY'
  WHEN 'JO1' THEN 'JAM'
  WHEN 'Number_i' THEN 'iLYs'
  WHEN 'BE:FIRST' THEN 'BESTY'
  WHEN 'King & Prince' THEN 'Tiara'
  WHEN 'ENHYPEN' THEN 'ENGENE'
  WHEN 'INI' THEN 'MINI'
  WHEN 'Stray Kids' THEN 'STAYS'
  WHEN 'TOMORROW X TOGETHER' THEN 'MOA'
  WHEN 'PLAVE' THEN 'PLLI'
  WHEN 'SB19' THEN 'ATIN'
  WHEN 'SEVENTEEN' THEN 'CARAT'
  WHEN 'LE SSERAFIM' THEN 'FEARNOT'
  WHEN 'BUS because of you i shine' THEN 'BEUS'
  WHEN 'ALPHA DRIVE ONE' THEN 'ALLYZ'
  WHEN 'Nicki Minaj' THEN 'Barbz'
  WHEN 'ROSÉ' THEN 'numberoneHQ'
  WHEN 'MARK' THEN 'Mark Lee HQ'
  ELSE stationhead_channel_name
END,
stationhead_channel_url = CASE artist_name
  WHEN '櫻坂46' THEN 'https://stationhead.com/c/buddies'
  WHEN 'SixTONES' THEN 'https://stationhead.com/c/teamsixtones'
  WHEN 'BTS' THEN 'https://stationhead.com/c/btsarmy'
  WHEN 'JO1' THEN 'https://stationhead.com/c/jam'
  WHEN 'Number_i' THEN 'https://stationhead.com/c/ilys'
  WHEN 'BE:FIRST' THEN 'https://stationhead.com/c/besty'
  WHEN 'King & Prince' THEN 'https://stationhead.com/c/tiara'
  WHEN 'ENHYPEN' THEN 'https://stationhead.com/c/engene'
  WHEN 'INI' THEN 'https://stationhead.com/c/mini'
  WHEN 'Stray Kids' THEN 'https://stationhead.com/c/stays'
  WHEN 'TOMORROW X TOGETHER' THEN 'https://stationhead.com/c/moa'
  WHEN 'PLAVE' THEN 'https://stationhead.com/c/plli'
  WHEN 'SB19' THEN 'https://stationhead.com/c/ATIN'
  WHEN 'SEVENTEEN' THEN 'https://stationhead.com/c/carat'
  WHEN 'LE SSERAFIM' THEN 'https://stationhead.com/c/fearnot'
  WHEN 'ROSÉ' THEN 'https://stationhead.com/c/numberonehq'
  WHEN 'MARK' THEN 'https://stationhead.com/c/markleehq'
  ELSE stationhead_channel_url
END
WHERE artist_name IN (
  '櫻坂46','SixTONES','BTS','JO1','Number_i','BE:FIRST','King & Prince','ENHYPEN','INI',
  'Stray Kids','TOMORROW X TOGETHER','PLAVE','SB19','SEVENTEEN','LE SSERAFIM',
  'BUS because of you i shine','ALPHA DRIVE ONE','Nicki Minaj','ROSÉ','MARK'
);

-- Correct the historical mis-attribution introduced in migration 036.
UPDATE sh_channel_fandoms
SET artist_name = 'SB19',
    relation_type = 'fandom',
    stationhead_channel_name = 'ATIN',
    stationhead_channel_url = 'https://stationhead.com/c/ATIN',
    source_url = 'https://stationhead.com/c/ATIN',
    source_note = 'Stationhead ATIN channel is for SB19; sbuddies1819 is not a Sakurazaka46 host.',
    verified_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE lower(host_name) = 'sbuddies1819';
