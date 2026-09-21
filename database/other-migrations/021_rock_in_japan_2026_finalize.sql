-- Finalize the 2026-09-21 ROCK IN JAPAN FESTIVAL listening party.
-- Canonical end minute: 12:16 JST. Data from 12:17 JST onward must not remain.
-- OTHER_DB provisioning replays every active migration, so every statement below
-- is intentionally idempotent and scoped to this event/session only.

-- Scheduled start: 2026-09-21 11:45:00 JST = 1789958700000.
-- End-exclusive deletion boundary: 2026-09-21 12:17:00 JST = 1789960620000.

UPDATE sh_official_news_announcements
SET status='ended',
    last_broadcast_at=1789960619999,
    inactive_streak=MAX(inactive_streak,2),
    updated_at=MAX(updated_at,1789960620000)
WHERE scheduled_at=1789958700000;

DELETE FROM sh_official_news_comments
WHERE observed_at>=1789960620000
  AND announcement_id IN (
    SELECT id FROM sh_official_news_announcements
    WHERE scheduled_at=1789958700000
  );

DELETE FROM sh_official_news_station_probes
WHERE observed_at>=1789960620000
  AND announcement_id IN (
    SELECT id FROM sh_official_news_announcements
    WHERE scheduled_at=1789958700000
  );

-- Remove chat rows only when the same minute belongs to the target broadcast.
DELETE FROM sh_sakurazaka46jp_chat
WHERE observed_at>=1789960620000
  AND observed_minute IN (
    SELECT m.observed_minute
    FROM sh_sakurazaka46jp_main m
    WHERE m.observed_at>=1789960620000
      AND (
        m.broadcast_id IN (
          SELECT broadcast_id FROM sh_host_broadcast_sessions
          WHERE source_scope='sakurazaka46jp_solo'
            AND lower(handle)='sakurazaka46jp'
            AND started_at>=1789957800000
            AND started_at<1789960620000
            AND broadcast_id IS NOT NULL
        )
        OR (
          json_valid(m.raw_json)
          AND CAST(json_extract(m.raw_json,'$.broadcast.id') AS INTEGER) IN (
            SELECT broadcast_id FROM sh_host_broadcast_sessions
            WHERE source_scope='sakurazaka46jp_solo'
              AND lower(handle)='sakurazaka46jp'
              AND started_at>=1789957800000
              AND started_at<1789960620000
              AND broadcast_id IS NOT NULL
          )
        )
      )
  );

DELETE FROM sh_sakurazaka46jp_main
WHERE observed_at>=1789960620000
  AND (
    broadcast_id IN (
      SELECT broadcast_id FROM sh_host_broadcast_sessions
      WHERE source_scope='sakurazaka46jp_solo'
        AND lower(handle)='sakurazaka46jp'
        AND started_at>=1789957800000
        AND started_at<1789960620000
        AND broadcast_id IS NOT NULL
    )
    OR (
      json_valid(raw_json)
      AND CAST(json_extract(raw_json,'$.broadcast.id') AS INTEGER) IN (
        SELECT broadcast_id FROM sh_host_broadcast_sessions
        WHERE source_scope='sakurazaka46jp_solo'
          AND lower(handle)='sakurazaka46jp'
          AND started_at>=1789957800000
          AND started_at<1789960620000
          AND broadcast_id IS NOT NULL
      )
    )
  );

DELETE FROM sh_sakurazaka46jp_track_metadata
WHERE observed_at>=1789960620000
  AND session_id IN (
    SELECT id FROM sh_host_broadcast_sessions
    WHERE source_scope='sakurazaka46jp_solo'
      AND lower(handle)='sakurazaka46jp'
      AND started_at>=1789957800000
      AND started_at<1789960620000
  );

DELETE FROM sh_host_profile_snapshots
WHERE observed_at>=1789960620000
  AND session_id IN (
    SELECT id FROM sh_host_broadcast_sessions
    WHERE source_scope='sakurazaka46jp_solo'
      AND lower(handle)='sakurazaka46jp'
      AND started_at>=1789957800000
      AND started_at<1789960620000
  );

DELETE FROM sh_host_queue_snapshots
WHERE observed_at>=1789960620000
  AND session_id IN (
    SELECT id FROM sh_host_broadcast_sessions
    WHERE source_scope='sakurazaka46jp_solo'
      AND lower(handle)='sakurazaka46jp'
      AND started_at>=1789957800000
      AND started_at<1789960620000
  );

DELETE FROM sh_host_queue_items
WHERE observed_at>=1789960620000
  AND session_id IN (
    SELECT id FROM sh_host_broadcast_sessions
    WHERE source_scope='sakurazaka46jp_solo'
      AND lower(handle)='sakurazaka46jp'
      AND started_at>=1789957800000
      AND started_at<1789960620000
  );

DELETE FROM sh_host_comments
WHERE observed_at>=1789960620000
  AND session_id IN (
    SELECT id FROM sh_host_broadcast_sessions
    WHERE source_scope='sakurazaka46jp_solo'
      AND lower(handle)='sakurazaka46jp'
      AND started_at>=1789957800000
      AND started_at<1789960620000
  );

DELETE FROM sh_host_raw_events
WHERE observed_at>=1789960620000
  AND session_id IN (
    SELECT id FROM sh_host_broadcast_sessions
    WHERE source_scope='sakurazaka46jp_solo'
      AND lower(handle)='sakurazaka46jp'
      AND started_at>=1789957800000
      AND started_at<1789960620000
  );

DELETE FROM sh_comment_velocity_samples
WHERE observed_at>=1789960620000
  AND session_id IN (
    SELECT id FROM sh_host_broadcast_sessions
    WHERE source_scope='sakurazaka46jp_solo'
      AND lower(handle)='sakurazaka46jp'
      AND started_at>=1789957800000
      AND started_at<1789960620000
  );

DELETE FROM sh_solo_activity_minutes
WHERE bucket_start>=1789960620000
  AND session_id IN (
    SELECT id FROM sh_host_broadcast_sessions
    WHERE source_scope='sakurazaka46jp_solo'
      AND lower(handle)='sakurazaka46jp'
      AND started_at>=1789957800000
      AND started_at<1789960620000
  );

DELETE FROM sh_solo_activity_days
WHERE day_key='2026-09-21'
  AND session_id IN (
    SELECT id FROM sh_host_broadcast_sessions
    WHERE source_scope='sakurazaka46jp_solo'
      AND lower(handle)='sakurazaka46jp'
      AND started_at>=1789957800000
      AND started_at<1789960620000
  );

INSERT INTO sh_solo_activity_days(session_id,day_key,item_count)
SELECT session_id,'2026-09-21',SUM(item_count)
FROM sh_solo_activity_minutes
WHERE bucket_start<1789960620000
  AND session_id IN (
    SELECT id FROM sh_host_broadcast_sessions
    WHERE source_scope='sakurazaka46jp_solo'
      AND lower(handle)='sakurazaka46jp'
      AND started_at>=1789957800000
      AND started_at<1789960620000
  )
GROUP BY session_id
HAVING SUM(item_count)>0
ON CONFLICT(session_id,day_key) DO UPDATE SET item_count=excluded.item_count;

UPDATE sh_solo_activity_state
SET total_count=COALESCE((
      SELECT SUM(m.item_count) FROM sh_solo_activity_minutes m
      WHERE m.session_id=sh_solo_activity_state.session_id
        AND m.bucket_start<1789960620000
    ),0),
    last_observed_at=COALESCE((
      SELECT MAX(m.bucket_start) FROM sh_solo_activity_minutes m
      WHERE m.session_id=sh_solo_activity_state.session_id
        AND m.bucket_start<1789960620000
    ),0)
WHERE session_id IN (
  SELECT id FROM sh_host_broadcast_sessions
  WHERE source_scope='sakurazaka46jp_solo'
    AND lower(handle)='sakurazaka46jp'
    AND started_at>=1789957800000
    AND started_at<1789960620000
);

DELETE FROM sh_host_station_snapshots
WHERE observed_at>=1789960620000
  AND session_id IN (
    SELECT id FROM sh_host_broadcast_sessions
    WHERE source_scope='sakurazaka46jp_solo'
      AND lower(handle)='sakurazaka46jp'
      AND started_at>=1789957800000
      AND started_at<1789960620000
  );

UPDATE sh_host_broadcast_sessions
SET ended_at=1789960619999,
    status='ended',
    end_reason='official_event_ended_12_16_jst',
    last_observed_at=COALESCE((
      SELECT MAX(s.observed_at) FROM sh_host_station_snapshots s
      WHERE s.session_id=sh_host_broadcast_sessions.id
        AND s.observed_at<1789960620000
    ),1789960619999),
    peak_listeners=(
      SELECT MAX(s.listener_count) FROM sh_host_station_snapshots s
      WHERE s.session_id=sh_host_broadcast_sessions.id
        AND s.observed_at<1789960620000
    ),
    listener_sum=COALESCE((
      SELECT SUM(s.listener_count) FROM sh_host_station_snapshots s
      WHERE s.session_id=sh_host_broadcast_sessions.id
        AND s.observed_at<1789960620000
        AND s.listener_count IS NOT NULL
    ),0),
    listener_sample_count=(
      SELECT COUNT(s.listener_count) FROM sh_host_station_snapshots s
      WHERE s.session_id=sh_host_broadcast_sessions.id
        AND s.observed_at<1789960620000
    ),
    average_listeners=(
      SELECT AVG(s.listener_count) FROM sh_host_station_snapshots s
      WHERE s.session_id=sh_host_broadcast_sessions.id
        AND s.observed_at<1789960620000
        AND s.listener_count IS NOT NULL
    ),
    total_listens_end=(
      SELECT s.total_listens FROM sh_host_station_snapshots s
      WHERE s.session_id=sh_host_broadcast_sessions.id
        AND s.observed_at<1789960620000
      ORDER BY s.observed_at DESC,s.id DESC LIMIT 1
    ),
    track_count=COALESCE((
      SELECT COUNT(DISTINCT COALESCE(
        CAST(q.stationhead_track_id AS TEXT),q.spotify_id,CAST(q.queue_track_id AS TEXT)))
      FROM sh_host_queue_items q
      WHERE q.session_id=sh_host_broadcast_sessions.id
        AND q.observed_at<1789960620000
    ),0),
    comment_count=COALESCE((
      SELECT SUM(m.item_count) FROM sh_solo_activity_minutes m
      WHERE m.session_id=sh_host_broadcast_sessions.id
        AND m.bucket_start<1789960620000
    ),0)
WHERE source_scope='sakurazaka46jp_solo'
  AND lower(handle)='sakurazaka46jp'
  AND started_at>=1789957800000
  AND started_at<1789960620000;

UPDATE sh_official_broadcast_summary
SET ended_at=1789960619999,
    ended_jst='2026-09-21 12:16:59',
    sample_count=(
      SELECT COUNT(m.listener_count)
      FROM sh_sakurazaka46jp_main m
      WHERE m.observed_at<1789960620000
        AND m.broadcast_id IN (
          SELECT broadcast_id FROM sh_host_broadcast_sessions
          WHERE source_scope='sakurazaka46jp_solo'
            AND lower(handle)='sakurazaka46jp'
            AND started_at>=1789957800000
            AND started_at<1789960620000
            AND broadcast_id IS NOT NULL
        )
    ),
    listener_avg=(
      SELECT AVG(m.listener_count)
      FROM sh_sakurazaka46jp_main m
      WHERE m.observed_at<1789960620000
        AND m.listener_count IS NOT NULL
        AND m.broadcast_id IN (
          SELECT broadcast_id FROM sh_host_broadcast_sessions
          WHERE source_scope='sakurazaka46jp_solo'
            AND lower(handle)='sakurazaka46jp'
            AND started_at>=1789957800000
            AND started_at<1789960620000
            AND broadcast_id IS NOT NULL
        )
    ),
    listener_max=(
      SELECT MAX(m.listener_count)
      FROM sh_sakurazaka46jp_main m
      WHERE m.observed_at<1789960620000
        AND m.broadcast_id IN (
          SELECT broadcast_id FROM sh_host_broadcast_sessions
          WHERE source_scope='sakurazaka46jp_solo'
            AND lower(handle)='sakurazaka46jp'
            AND started_at>=1789957800000
            AND started_at<1789960620000
            AND broadcast_id IS NOT NULL
        )
    ),
    distinct_tracks=COALESCE((
      SELECT COUNT(DISTINCT COALESCE(spotify_id,isrc,CAST(stationhead_track_id AS TEXT)))
      FROM sh_sakurazaka46jp_track_metadata
      WHERE observed_at<1789960620000
        AND session_id IN (
          SELECT id FROM sh_host_broadcast_sessions
          WHERE source_scope='sakurazaka46jp_solo'
            AND lower(handle)='sakurazaka46jp'
            AND started_at>=1789957800000
            AND started_at<1789960620000
        )
    ),0),
    refreshed_at=MAX(refreshed_at,1789960620000)
WHERE host_handle='sakurazaka46jp'
  AND event_name='2026.09.21 『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』';

PRAGMA optimize;
