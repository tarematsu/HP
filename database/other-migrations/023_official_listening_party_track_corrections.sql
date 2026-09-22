-- Canonical corrections for historical official Stationhead listening parties.
-- Values below were verified against official Sakurazaka46 announcements / release tracklists.

UPDATE sh_official_broadcast_summary
SET distinct_tracks=20,
    refreshed_at=MAX(refreshed_at,CAST(strftime('%s','now') AS INTEGER)*1000)
WHERE host_handle='sakurazaka46jp'
  AND event_name='2024.07.23『YUI KOBAYASHI GRADUATION CONCERT』Stationhead Listening Party';

UPDATE sh_official_broadcast_summary
SET distinct_tracks=24,
    refreshed_at=MAX(refreshed_at,CAST(strftime('%s','now') AS INTEGER)*1000)
WHERE host_handle='sakurazaka46jp'
  AND event_name='2025.04.30 2nd Album『Addiction』Stationheadリスニングパーティー';

UPDATE sh_official_broadcast_summary
SET distinct_tracks=7,
    refreshed_at=MAX(refreshed_at,CAST(strftime('%s','now') AS INTEGER)*1000)
WHERE host_handle='sakurazaka46jp'
  AND event_name='2025.10.29 13th Single『Unhappy birthday構文』リリース記念Stationheadリスニングパーティー';

UPDATE sh_official_broadcast_summary
SET distinct_tracks=22,
    refreshed_at=MAX(refreshed_at,CAST(strftime('%s','now') AS INTEGER)*1000)
WHERE host_handle='sakurazaka46jp'
  AND event_name='2025.12.30『THANK YOU BUDDIES!! THANK YOU 2025!! 櫻坂46 YEAR-END LISTENING PARTY』';

PRAGMA optimize;
