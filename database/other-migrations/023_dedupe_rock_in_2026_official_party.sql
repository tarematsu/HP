-- Keep only the canonical 2026-09-21 ROCK IN JAPAN FESTIVAL listening-party row.
-- The finalized event is already materialized under the dated canonical title, so
-- auto-detected aliases must not remain as separate official-listening-party rows.

DELETE FROM sh_official_broadcast_series
WHERE host_handle='sakurazaka46jp'
  AND lower(event_name) LIKE '%rock in japan festival 2026%'
  AND event_name<>'2026.09.21 『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』';

DELETE FROM sh_official_broadcast_summary
WHERE host_handle='sakurazaka46jp'
  AND lower(event_name) LIKE '%rock in japan festival 2026%'
  AND event_name<>'2026.09.21 『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』';

PRAGMA optimize;
