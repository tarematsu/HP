-- Second historical leaderboard fandom backfill.
-- Keep uncertain handles unmapped; every row below has public evidence for the supported artist.
INSERT INTO sh_channel_fandoms(
  host_name, artist_name, relation_type, source_url, source_note, verified_at
) VALUES
  ('core1st', 'Travis Japan', 'fandom', 'https://instalker.org/Picchu1114', 'Public Travis Japan fan posts identify core1st as a Stationhead channel and link directly to it.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('girlsetofficial', 'GIRLSET', 'official', 'https://www.stationhead.com/', 'Stationhead surfaces girlsetofficial as a live artist station; the matching GIRLSETofficial account is the artist account.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('mamecco', '&TEAM', 'fandom', 'https://search.yahoo.co.jp/realtime/search?ei=UTF-8&ifr=tl_hash&p=%23STATIONHEAD_andTEAM&rkf=1', 'Posts from mamecco and other LUNÉ listeners identify the Stationhead activity as an &TEAM fan streaming channel.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('officialhige', 'Official髭男dism', 'official', 'https://x.com/officialhige', 'Official髭男dism official account announces its own Stationhead listening parties under the matching handle.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('sb19manastreamer', 'SB19', 'fandom', 'https://www.stationhead.com/sb19manastreamer', 'Stationhead channel is part of the SB19 fan-streaming ecosystem and is promoted by A’TIN for SB19 streaming.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('sb19rtsquadofc', 'SB19', 'fandom', 'https://www.sotwe.com/sb19rtsquadofc?lang=en', 'SB19 RETWEET SQUAD OFC identifies itself as an SB19 support/retweet fan account rather than the artist.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('sb19serenadia', 'SB19', 'fandom', 'https://www.reddit.com/r/sb19/comments/1q8ziiy/sb19_x_alamat_2day_stationhead_collab/', 'SB19/ALAMAT fan collaboration explicitly links stationhead.com/sb19serenadia as the SB19-side station.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('swagradio19', 'SB19', 'fandom', 'https://ww.twstalker.com/SB19BBCharts', 'SwagRadio19 profile identifies the station as a unified Stationhead channel of an SB19 fanbase.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('tetekoofm', 'V・Jung Kook', 'fandom', 'https://twstalker.com/TaekookEurope', 'TAEKOOK STATION profile explicitly says it is a 24/7 Stationhead station dedicated to supporting V and Jung Kook.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('wer1streams', 'Rony Parulian', 'fandom', 'https://twicopy.com/wer1streams/', 'WeR1Streams identifies itself as the streaming team of Rony Parulian; classified as fandom/support team rather than artist-run official.', CAST(strftime('%s', 'now') AS INTEGER) * 1000)
ON CONFLICT(host_name) DO UPDATE SET
  artist_name = excluded.artist_name,
  relation_type = excluded.relation_type,
  source_url = excluded.source_url,
  source_note = excluded.source_note,
  verified_at = excluded.verified_at;