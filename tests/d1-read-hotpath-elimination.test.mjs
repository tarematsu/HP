import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  MATERIALIZED_API_VARIANTS,
  canonicalApiCacheRequest,
  materializedApiKey,
} from '../site/functions/lib/api-contract.js';
import { CURRENT_DAILY_MINUTE_SUMMARY_SQL } from '../site/functions/lib/current-minute-summary.js';
import { minuteFactReconcileCandidates } from '../worker/src/minute-facts-day-reconcile.js';

const middleware = readFileSync(new URL('../site/functions/_middleware.js', import.meta.url), 'utf8');
const reconcile = readFileSync(new URL('../worker/src/minute-facts-day-reconcile.js', import.meta.url), 'utf8');
const realtimeWorkflow = readFileSync(new URL('../.github/workflows/refresh-pages-realtime.yml', import.meta.url), 'utf8');
const realtimeRunner = readFileSync(new URL('../worker/scripts/refresh-pages-realtime-actions.mjs', import.meta.url), 'utf8');
const realtimeWatchdog = readFileSync(new URL('../worker/src/pages-realtime-read-model-watchdog.js', import.meta.url), 'utf8');
const factsDescriptor = JSON.parse(readFileSync(new URL('../database/facts-db.json', import.meta.url), 'utf8'));
const currentProjectionMigration = readFileSync(
  new URL('../database/facts-migrations/052_current_daily_summary_projection.sql', import.meta.url),
  'utf8',
);

test('dashboard delta-shaped requests are normalized to the R2 dashboard model', () => {
  const delta = new URL('https://example.test/api/dashboard?since=123&queue_revision=abc&history=0');
  assert.equal(materializedApiKey(delta), 'dashboard');
  const canonical = new URL(canonicalApiCacheRequest(new Request(delta)).url);
  assert.equal(canonical.pathname, '/api/dashboard');
  assert.equal(canonical.search, '');
  assert.match(middleware, /const LIVE_PAGES_FALLBACK_MODEL_KEYS = new Set\(\);/);
  assert.match(middleware, /materialized response unavailable/);
});

test('dashboard freshness is checked every five minutes by the Worker watchdog', () => {
  const dashboard = MATERIALIZED_API_VARIANTS.find(({ key }) => key === 'dashboard');
  assert.equal(dashboard?.cadence_minutes, 5);
  assert.doesNotMatch(realtimeWorkflow, /cron:/);
  assert.match(realtimeWorkflow, /workflow_dispatch:/);
  assert.match(realtimeWatchdog, /PAGES_REALTIME_WATCHDOG_INTERVAL_MS = 5 \* 60_000/);
  assert.match(realtimeWatchdog, /PAGES_REALTIME_STALE_AFTER_MS = 9 \* 60_000/);
  assert.match(realtimeWatchdog, /refresh-pages-realtime\.yml\/dispatches/);
  assert.match(realtimeRunner, /variant\.key === 'dashboard'/);
  assert.doesNotMatch(realtimeRunner, /history:daily|history:weekly|history:monthly/);
});

test('current daily history reads a one-row projection rather than minute facts', () => {
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /FROM sh_current_daily_summary AS p/);
  assert.doesNotMatch(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /prepared AS MATERIALIZED/);
  assert.match(currentProjectionMigration, /CREATE TABLE IF NOT EXISTS sh_current_daily_summary/);
  assert.match(currentProjectionMigration, /AFTER INSERT ON sh_minute_facts/);
  assert.match(currentProjectionMigration, /AFTER UPDATE OF listener_count,reported_current_stream_count,total_member_count/);
  assert.equal(factsDescriptor.schema, factsDescriptor.migrations.at(-1));
  assert.equal(
    factsDescriptor.migrations.includes('database/facts-migrations/052_current_daily_summary_projection.sql'),
    true,
  );
});

test('historical reconcile rotates once per UTC day while yesterday remains hourly', () => {
  const day = Date.parse('2026-09-21T00:00:00Z');
  const atMidnight = minuteFactReconcileCandidates(day + 10 * 60_000);
  const atOne = minuteFactReconcileCandidates(day + 60 * 60_000 + 10 * 60_000);
  assert.equal(atMidnight.length, 4);
  assert.equal(atOne.length, 1);
  assert.equal(atOne[0].key, '2026-09-20');
  assert.match(reconcile, /loadSourceTip/);
  assert.doesNotMatch(reconcile, /const verified = await loadExpectedMinutes/);
  assert.doesNotMatch(reconcile, /generation !== sourceFingerprint\(verified\)/);
});
