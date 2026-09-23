-- Backfill fandom metadata for historical Stationhead leaderboard hosts.
-- Only hosts with a public source tying the Stationhead/X handle to an artist are included.
INSERT INTO sh_channel_fandoms(
  host_name, artist_name, relation_type, source_url, source_note, verified_at
) VALUES
  ('aespaintl', 'aespa', 'fandom', 'https://linktr.ee/aespaintlstation', 'AESPAIntl streaming team lists aespaintl as its Stationhead channel.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('ahofstreamers9', 'AHOF', 'fandom', 'https://twstalker.com/yeshey_0001/status/1978039386617909325', 'AHOF STREAMERS release-party post lists this Stationhead handle as an AHOF co-host.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('ahofstreamingph', 'AHOF', 'fandom', 'https://twstalker.com/yeshey_0001/status/1978039386617909325', 'AHOF STREAMERS release-party post lists this Stationhead handle as an AHOF co-host.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('ahofstreamverse', 'AHOF', 'fandom', 'https://twstalker.com/yeshey_0001/status/1978039386617909325', 'AHOF STREAMERS release-party post lists this Stationhead handle as an AHOF co-host.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('atinplaylist', 'SB19', 'fandom', 'https://www.stationhead.com/atinplaylist', 'Stationhead profile explicitly advertises an SB19 event.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('backstreetboys', 'Backstreet Boys', 'official', 'https://home.stationhead.com/', 'Stationhead lists Backstreet Boys @backstreetboys in its Artists on Stationhead directory.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('binistation', 'BINI', 'fandom', 'https://twstalker.com/lyssxxasa', 'BINI Stationhead profile describes an independent streamer collective dedicated to promoting BINI.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('binistreamteam', 'BINI', 'fandom', 'https://www.reddit.com/r/bini_ph/comments/1p6ewb5/stationhead/', 'BINI streaming guidance tells Blooms to search binistreamteam on Stationhead.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('btsinspain', 'BTS', 'fandom', 'https://www30.twstalker.com/army_tb', 'ARMY Spain posts link stationhead.com/btsinspain for BTS streaming.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('changbinstation', 'Changbin', 'fandom', 'https://ww.twstalker.com/ChangbinStation', 'Profile states Stationhead base dedicated to Stray Kids member Changbin.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('heysayjumpstorm', 'Hey! Say! JUMP', 'official', 'https://web.storm-labels.co.jp/s/st/news/detail/14549', 'Storm Labels explicitly identifies heysayjumpstorm as the official Hey! Say! JUMP Stationhead account.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('hitmehardandsoft', 'Billie Eilish', 'fandom', 'https://www.reddit.com/r/billieeilish/comments/1pu3uo2/stationhead_acc/', 'Billie Eilish community identifies hitmehardandsoft as fan-run rather than the official artist account.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('hobistreamclub', 'j-hope', 'fandom', 'https://www.stationhead.com/hobistreamclub', 'Stationhead profile identifies the station with j-hope.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('imp818', 'IMP.', 'fandom', 'https://search.yahoo.co.jp/realtime/search?p=%23IMP', 'Public X search results describe imp818 as a PINKY fan-operated 24/7 IMP. Stationhead station.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('impofficial', 'IMP.', 'official', 'https://e.usen.com/news/news-release/imp-4135th-singleinvader.html', 'IMP. official-site coverage links the PINKY.Station URL to stationhead.com/impofficial and member appearances.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('issueofficial', 'IS:SUE', 'official', 'https://is-sue.jp/news/detail/618', 'IS:SUE official site directs listeners to follow issueofficial for the group listening party with member participation.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('jo1station', 'JO1', 'fandom', 'https://www.24vids.com/channel/jo1stationteam', 'JO1station profile says it is a Stationhead account run by JO1 fandom JAM.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('livieshq', 'Olivia Rodrigo', 'fandom', 'https://linktr.ee/livieshq', 'LiviesHQ links its Livies Stationhead channel and Olivia Rodrigo fan resources.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('lthqofficial', 'Louis Tomlinson', 'official', 'https://home.stationhead.com/', 'Stationhead lists Louis Tomlinson @lthqofficial in its Artists on Stationhead directory.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('nctdreamofficial', 'NCT DREAM', 'fandom', 'https://7dreamglobal.wordpress.com/stationhead/', '7DREAM GLOBAL identifies nctdreamofficial as its Stationhead channel used to support NCT DREAM.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('numberiofficial', 'Number_i', 'official', 'https://wmg.jp/number-i/news/108043', 'Number_i release notice explicitly calls numberiofficial the official Stationhead account.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('numberonehq', 'ROSÉ', 'fandom', 'https://www.stationhead.com/c/numberonehq', 'Stationhead channel page labels numberoneHQ as Fans of ROSÉ.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('ryugujoofficial', '龍宮城', 'official', 'https://www.sonymusic.co.jp/artist/ryugujo/info/575816', 'Sony Music identifies ryugujoofficial as the official 龍宮城 Stationhead account.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('sekainoowariofc', 'SEKAI NO OWARI', 'official', 'https://sekainoowari.jp/info/2026/07/07/6032/', 'SEKAI NO OWARI official site links its Stationhead account to sekainoowariofc.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('seventeenstation', 'SEVENTEEN', 'fandom', 'https://search.yahoo.co.jp/realtime/search?p=%23SEVENTEEN', 'SVT support fan account promotes seventeenstation as the Japanese CARAT Stationhead stream.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('straykids', 'Stray Kids', 'official', 'https://home.stationhead.com/', 'Stationhead lists Stray Kids @straykids in its Artists on Stationhead directory.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('superdragon', 'SUPER★DRAGON', 'official', 'https://super-dragon.jp/news/news9490/', 'SUPER★DRAGON official site announces its official Stationhead account and tells fans to follow superdragon.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('txtintlonair', 'TOMORROW X TOGETHER', 'fandom', 'https://search.yahoo.co.jp/realtime/search?p=%23MOAisONE', 'TXT INTERNATIONAL public posts direct MOA streaming events to stationhead.com/txtintlonair.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('vstreamteam', 'V', 'fandom', 'https://vstreamteam.carrd.co/', 'V Stream Team page is dedicated to V and includes its Stationhead resource.', CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('wearewest7', 'WEST.', 'official', 'https://search.yahoo.co.jp/realtime/search?p=id%3AWEareWEST7', 'WEST. official X account repeatedly links stationhead.com/wearewest7 for official listening parties.', CAST(strftime('%s', 'now') AS INTEGER) * 1000)
ON CONFLICT(host_name) DO UPDATE SET
  artist_name = excluded.artist_name,
  relation_type = excluded.relation_type,
  source_url = excluded.source_url,
  source_note = excluded.source_note,
  verified_at = excluded.verified_at;