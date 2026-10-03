-- Finish removing the temporary sakuramankai validation run from 2026-09-30 JST.
-- Migration 057 removed the raw smoke-test/session rows, but the later
-- official-listening-party read models can retain materialized summary/series
-- rows. Keep this cleanup bounded to the exact test window and Nogizaka host.

DELETE FROM sh_official_broadcast_series
WHERE host_handle='nogizaka46smej'
  AND started_at>=1790703900000 AND started_at<1790708400000;

DELETE FROM sh_official_broadcast_summary
WHERE host_handle='nogizaka46smej'
  AND started_at>=1790703900000 AND started_at<1790708400000;

-- Re-run the bounded raw cleanup for any rows that survived or were recreated
-- before the original smoke-test announcement was deleted. The old dedicated
-- chat table was retired by migration 058, so it is intentionally not touched.
DELETE FROM sh_nogizaka_official_news_station_probes
WHERE (observed_at>=1790703900000 AND observed_at<1790708400000
       AND station_id=3328626 AND broadcast_id=3604336)
   OR announcement_id IN (
     SELECT id FROM sh_nogizaka_official_news_announcements
     WHERE news_id='manual-test-sakuramankai-20260930'
   );

DELETE FROM sh_nogizaka46smej_main
WHERE observed_at>=1790703900000 AND observed_at<1790708400000
  AND station_id=3328626 AND broadcast_id=3604336;

DELETE FROM sh_nogizaka_official_news_announcements
WHERE news_id='manual-test-sakuramankai-20260930';

PRAGMA optimize;
