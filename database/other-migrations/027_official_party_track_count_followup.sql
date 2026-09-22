-- Follow-up corrections for official Stationhead listening-party track counts.
-- 2025-10-29 experienced playback trouble, so the actual broadcast played five tracks.
-- 2025-12-30 duration cross-check:
--   22 regular 2025 releases = 86m33s
--   Addiction Interlude #1-#7 = 6m46s
--   total = 29 tracks / 93m19s, matching the ~93-minute 20:00-21:33 broadcast.

UPDATE sh_official_broadcast_summary
SET distinct_tracks=5,
    refreshed_at=MAX(refreshed_at,CAST(strftime('%s','now') AS INTEGER)*1000)
WHERE host_handle='sakurazaka46jp'
  AND event_name='2025.10.29 13th Single『Unhappy birthday構文』リリース記念Stationheadリスニングパーティー';

UPDATE sh_official_broadcast_summary
SET distinct_tracks=29,
    refreshed_at=MAX(refreshed_at,CAST(strftime('%s','now') AS INTEGER)*1000)
WHERE host_handle='sakurazaka46jp'
  AND event_name='2025.12.30『THANK YOU BUDDIES!! THANK YOU 2025!! 櫻坂46 YEAR-END LISTENING PARTY』';

PRAGMA optimize;
