-- Remove the temporary sakuramankai validation data produced by the
-- sh-nogizaka46smej production-path smoke test on 2026-09-30 JST.
-- The window and session identity are intentionally bounded so future real
-- Nogizaka collection can never match this cleanup when migrations replay.

DROP TRIGGER IF EXISTS trg_nogizaka_sakuramankai_test_ignore_buddies;

-- Only tables that are part of the active OTHER_DB schema are referenced here.
-- Test session identity observed during the smoke run:
-- station_id=3328626, broadcast_id=3604336, handle=sakuramankai.
DELETE FROM sh_nogizaka46smej_track_metadata
WHERE session_id IN (
  SELECT id FROM sh_host_broadcast_sessions
  WHERE source_scope='nogizaka46smej_solo'
    AND lower(handle)='sakuramankai'
    AND station_id=3328626
    AND broadcast_id=3604336
);

DELETE FROM sh_comment_velocity_samples
WHERE session_id IN (
  SELECT id FROM sh_host_broadcast_sessions
  WHERE source_scope='nogizaka46smej_solo'
    AND lower(handle)='sakuramankai'
    AND station_id=3328626
    AND broadcast_id=3604336
);

DELETE FROM sh_solo_activity_minutes
WHERE session_id IN (
  SELECT id FROM sh_host_broadcast_sessions
  WHERE source_scope='nogizaka46smej_solo'
    AND lower(handle)='sakuramankai'
    AND station_id=3328626
    AND broadcast_id=3604336
);

DELETE FROM sh_solo_activity_days
WHERE session_id IN (
  SELECT id FROM sh_host_broadcast_sessions
  WHERE source_scope='nogizaka46smej_solo'
    AND lower(handle)='sakuramankai'
    AND station_id=3328626
    AND broadcast_id=3604336
);

DELETE FROM sh_solo_activity_state
WHERE session_id IN (
  SELECT id FROM sh_host_broadcast_sessions
  WHERE source_scope='nogizaka46smej_solo'
    AND lower(handle)='sakuramankai'
    AND station_id=3328626
    AND broadcast_id=3604336
);

DELETE FROM sh_host_queue_items
WHERE session_id IN (
  SELECT id FROM sh_host_broadcast_sessions
  WHERE source_scope='nogizaka46smej_solo'
    AND lower(handle)='sakuramankai'
    AND station_id=3328626
    AND broadcast_id=3604336
);

DELETE FROM sh_host_queue_snapshots
WHERE session_id IN (
  SELECT id FROM sh_host_broadcast_sessions
  WHERE source_scope='nogizaka46smej_solo'
    AND lower(handle)='sakuramankai'
    AND station_id=3328626
    AND broadcast_id=3604336
);

DELETE FROM sh_host_station_snapshots
WHERE session_id IN (
  SELECT id FROM sh_host_broadcast_sessions
  WHERE source_scope='nogizaka46smej_solo'
    AND lower(handle)='sakuramankai'
    AND station_id=3328626
    AND broadcast_id=3604336
);

DELETE FROM sh_host_broadcast_sessions
WHERE source_scope='nogizaka46smej_solo'
  AND lower(handle)='sakuramankai'
  AND station_id=3328626
  AND broadcast_id=3604336;

-- 2026-09-30 02:45–04:00 JST, covering the full temporary test only.
DELETE FROM sh_nogizaka_official_news_station_probes
WHERE announcement_id IN (
  SELECT id FROM sh_nogizaka_official_news_announcements
  WHERE news_id='manual-test-sakuramankai-20260930'
);

DELETE FROM sh_nogizaka46smej_chat
WHERE observed_at>=1790703900000 AND observed_at<1790708400000
  AND station_id=3328626;

DELETE FROM sh_nogizaka46smej_main
WHERE observed_at>=1790703900000 AND observed_at<1790708400000;

DELETE FROM sh_nogizaka_official_news_announcements
WHERE news_id='manual-test-sakuramankai-20260930';

-- The guest credentials were issued while the worker target was sakuramankai.
-- Removing only the test-window state forces a fresh login for nogizaka46smej.
DELETE FROM sh_worker_auth_control
WHERE id='nogizaka46smej'
  AND updated_at>=1790703900000 AND updated_at<1790708400000;

DELETE FROM sh_worker_collector_state
WHERE id='nogizaka46smej'
  AND updated_at>=1790703900000 AND updated_at<1790708400000;

PRAGMA optimize;
