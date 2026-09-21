-- Keep only the canonical 2026-09-21 ROCK IN JAPAN FESTIVAL listening-party row.
-- The finalized event is materialized under the dated canonical title. Remove
-- auto-detected aliases and the now-obsolete official-news probe source so the
-- fail-safe path cannot recreate a second series for the completed event.

DELETE FROM sh_official_broadcast_series
WHERE host_handle='sakurazaka46jp'
  AND lower(event_name) LIKE '%rock in japan festival 2026%'
  AND event_name<>'2026.09.21 『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』';

DELETE FROM sh_official_broadcast_summary
WHERE host_handle='sakurazaka46jp'
  AND lower(event_name) LIKE '%rock in japan festival 2026%'
  AND event_name<>'2026.09.21 『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』';

DELETE FROM sh_official_news_comments
WHERE announcement_id IN (
  SELECT id FROM sh_official_news_announcements
  WHERE lower(event_name) LIKE '%rock in japan festival 2026%'
);

DELETE FROM sh_official_news_station_probes
WHERE announcement_id IN (
  SELECT id FROM sh_official_news_announcements
  WHERE lower(event_name) LIKE '%rock in japan festival 2026%'
);

DELETE FROM sh_official_news_announcements
WHERE lower(event_name) LIKE '%rock in japan festival 2026%';

PRAGMA optimize;
