-- Third historical leaderboard fandom backfill.
-- Keep uncertain handles unmapped; every row below has public evidence for the supported artist.
INSERT INTO sh_channel_fandoms(
  host_name, artist_name, relation_type, source_url, source_note, verified_at
) VALUES
  ('andteamkyumin', 'K (&TEAM)', 'fandom', 'https://www.myloveidol.com/community/?group=100784&idol=100786', 'The exact andteamkyumin username appears in the K (&TEAM) fandom community; classified as fan support rather than artist-run official.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('armypulseph', 'BTS', 'fandom', 'https://twstalker.com/TheARMYPulsePH', 'ARMY Pulse PH identifies itself as a BTS-only fan community; the matching armypulseph Stationhead station is part of that fan operation.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('berbinarstation', 'Shabrina Leanor', 'fandom', 'https://lnk.bio/berbinarstation', 'Berbinar Station describes itself as a streaming platform for Shabrina Leanor songs and links its Stationhead presence; it is a support station rather than the artist account.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('enhypenonspotify', 'ENHYPEN', 'fandom', 'https://site.twstalker.com/enhastreams', 'ENHYPEN on Spotify is identified as an ENHYPEN fanbase and publicly promotes its Stationhead streaming parties.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('fajarsoulstreams', 'Fajar Noor', 'fandom', 'https://linktr.ee/fajarsoulstreams', 'Fajarsoulstreams says it supports Fajar Noor and directly lists its Fajarsoul StationHead channels.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('fhoneinluv', 'Quang Hùng MasterD', 'fandom', 'https://fanclubmedia.vn/diem-danh-nhung-bai-du-thi-hay-nhat-trong-cuoc-thi-shining-star/', 'Fanclub Media identifies Fhoneinluv as the fan entry for Quang Hùng MasterD and describes the supporters as Muzik fans.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('jjst', 'Jung Kook', 'fandom', 'https://source.twstalker.com/JKJP_STREAM_', 'Jungkook JAPAN Streaming Team identifies itself as a Jung Kook fan account and repeatedly promotes its JJST Stationhead streams.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('nctdreamvn', 'NCT DREAM', 'fandom', 'https://7dreamglobal.wordpress.com/dreamville/', '7DREAM GLOBAL lists @NCTDREAMVN as a Vietnam NCT DREAM fanbase; the exact historical host name matches that fanbase handle.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('radyodisiotso', 'SB19', 'fandom', 'https://open.spotify.com/show/3z3m4gCTB0rYk2BO3egl0k', 'Radyo Disiotso states it is managed by Familia Fresco and focuses on streaming SB19 songs via Stationhead.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('yumajpnfb', 'YUMA (&TEAM)', 'fandom', 'https://x.com/YUMA_JPNFB', 'YUMA JAPAN FANBASE explicitly identifies itself as a Japanese fanbase supporting &TEAM member YUMA; historical Stationhead handle uses the same name without the underscore.', CAST(strftime('%s', 'now') AS INTEGER) * 1000)
ON CONFLICT(host_name) DO UPDATE SET
  artist_name = excluded.artist_name,
  relation_type = excluded.relation_type,
  source_url = excluded.source_url,
  source_note = excluded.source_note,
  verified_at = excluded.verified_at;