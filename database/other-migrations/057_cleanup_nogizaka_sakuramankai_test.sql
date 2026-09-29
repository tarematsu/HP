-- Remove the temporary sakuramankai validation data produced by the
-- sh-nogizaka46smej production-path smoke test on 2026-09-30 JST.
-- The window is intentionally bounded so future real Nogizaka collection
-- can never be removed when migrations are replayed.

DROP TRIGGER IF EXISTS trg_nogizaka_sakuramankai_test_ignore_buddies;

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

DELETE FROM sh_host_comments
WHERE session_id IN (
  SELECT id FROM sh_host_broadcast_sessions
  WHERE source_scope='nogizaka46smej_solo'
    AND lower(handle)='sakuramankai'
    AND station_id=3328626
    AND broadcast_id=3604336
);

DELETE FROM sh_host_raw_events
WHERE session_id IN (
  SELECT id FROM sh_host_broadcast_sessions
  WHERE source_scope='nogizaka46smej_solo'
    AND lower(handle)='sakuramankai'
    AND station_id=3328626
    AND broadcast_id=3604336
);

DELETE FROM sh_host_profile_snapshots
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
DELETE FROM sh_ingest_conflicts
WHERE observed_at>=1790703900000 AND observed_at<1790708400000
  AND (canonical_collector_id='sh-nogizaka46smej-raw'
    OR incoming_collector_id='sh-nogizaka46smej-raw');

DELETE FROM sh_ingest_claims
WHERE observed_at>=1790703900000 AND observed_at<1790708400000
  AND collector_id='sh-nogizaka46smej-raw';

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

-- Force a fresh guest authentication against the restored Nogizaka handle.
DELETE FROM sh_worker_auth_control
WHERE id='nogizaka46smej'
  AND updated_at>=1790703900000 AND updated_at<1790708400000;

DELETE FROM sh_worker_collector_state
WHERE id='nogizaka46smej'
  AND updated_at>=1790703900000 AND updated_at<1790708400000;

PRAGMA optimize;
