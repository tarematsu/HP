-- The smoke session began at 01:01 JST, before migration 070's time window.
-- Remove only the named test from materialized tables, retaining real events.
DELETE FROM sh_official_broadcast_series
WHERE host_handle='nogizaka46smej'
  AND event_name='Nogizaka collector temporary sakuramankai test';
DELETE FROM sh_official_broadcast_summary
WHERE host_handle='nogizaka46smej'
  AND event_name='Nogizaka collector temporary sakuramankai test';
DELETE FROM sh_nogizaka46smej_main
WHERE observed_at>=1790697600000 AND observed_at<1790708400000
  AND station_id=3328626 AND broadcast_id=3604336;
DELETE FROM sh_nogizaka_official_news_station_probes
WHERE observed_at>=1790697600000 AND observed_at<1790708400000
  AND station_id=3328626 AND broadcast_id=3604336;
