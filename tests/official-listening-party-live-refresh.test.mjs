import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('official listening party uses live refresh only while collection is active', () => {
  const status = readFileSync(new URL('../site/functions/api/sakurazaka46jp-status.js', import.meta.url), 'utf8');
  const summary = readFileSync(new URL('../site/public/history/history-broadcast-summary.js', import.meta.url), 'utf8');
  const historyEntry = readFileSync(new URL('../site/public/history/history-main.js', import.meta.url), 'utf8');

  assert.match(status, /cache-control': 'no-store'/);
  assert.match(status, /collection_active: Boolean\(activeAnnouncement\)/);
  assert.match(status, /WHERE status='active'/);
  assert.match(summary, /LIVE_REFRESH_MS = 15_000/);
  assert.match(summary, /\/api\/sakurazaka46jp-status/);
  assert.match(summary, /statusPayload\.collection_active !== true/);
  assert.match(summary, /liveCollectionActive !== true/);
  assert.match(summary, /liveCollectionActive === true/);
  assert.match(summary, /mergeLiveSeries/);
  assert.match(summary, /SERIES_CACHE_PREFIX = 'sakurazaka46jp:v1:'/);
  assert.match(summary, /document\.getElementById\('load'\)\?\.click\(\)/);
  assert.doesNotMatch(summary, /scheduleLiveRefresh\(0\);\s*$/m);
  assert.match(historyEntry, /history-broadcast-summary\.js\?v=20260923\.2/);
  assert.match(historyEntry, /history-broadcasts\.js\?v=20260923\.2/);
});

test('ended official listening parties are materialized into the canonical read model', () => {
  const reconcile = readFileSync(new URL('../worker/src/official-news-reconcile.js', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../database/other-migrations/022_rock_in_japan_2026_read_model.sql', import.meta.url), 'utf8');
  const requiredTables = readFileSync(new URL('../worker/scripts/other-db-tables.mjs', import.meta.url), 'utf8');

  assert.match(reconcile, /materializeEndedOfficialReadModels/);
  assert.match(reconcile, /a\.status='ended'/);
  assert.match(reconcile, /INSERT INTO sh_official_broadcast_series/);
  assert.match(reconcile, /'stationhead-finalized'/);
  assert.match(migration, /2026\.09\.21 『ROCK IN JAPAN FESTIVAL 2026 SETLIST LISTENING PARTY』/);
  assert.match(migration, /observed_at<1789960620000/);
  assert.match(migration, /INSERT INTO sh_official_broadcast_series/);
  assert.match(requiredTables, /'sh_official_broadcast_series'/);
});
