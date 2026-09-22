import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../database/other-migrations/023_dedupe_rock_in_2026_official_party.sql', import.meta.url), 'utf8');
const broadcasts = readFileSync(new URL('../site/public/history/history-broadcasts.js', import.meta.url), 'utf8');
const tweaks = readFileSync(new URL('../site/public/pages-ui-tweaks.js', import.meta.url), 'utf8');

const CANONICAL_EVENT = '2026.09.21 『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』';

test('ROCK IN 2026 cleanup keeps the dated canonical official-party rows', () => {
  assert.match(migration, /DELETE FROM sh_official_broadcast_series/);
  assert.match(migration, /DELETE FROM sh_official_broadcast_summary/);
  assert.match(migration, /lower\(event_name\) LIKE '%rock in japan festival 2026%'/);
  assert.ok(migration.includes(`event_name<>'${CANONICAL_EVENT}'`));
});

test('completed ROCK IN fail-safe source is retired so it cannot recreate a duplicate series', () => {
  assert.match(migration, /DELETE FROM sh_official_news_comments/);
  assert.match(migration, /DELETE FROM sh_official_news_station_probes/);
  assert.match(migration, /DELETE FROM sh_official_news_announcements/);
});

test('official-party cache/API revisions live at the single request owner', () => {
  assert.match(broadcasts, /CACHE_REVISION = '9'/);
  assert.match(broadcasts, /API_REVISION = '3'/);
  assert.match(broadcasts, /sakurazaka46jp:v1:r\$\{CACHE_REVISION\}:/);
  assert.match(broadcasts, /revision: API_REVISION/);
  assert.doesNotMatch(tweaks, /OFFICIAL_PARTY_CACHE_PREFIX|OFFICIAL_PARTY_API_REVISION|window\.fetch|clearOfficialPartyCache/);
});
