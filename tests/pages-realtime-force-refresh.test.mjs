import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const livePublisher = readFileSync(
  new URL('../worker/src/pages-dashboard-live-publisher.js', import.meta.url),
  'utf8',
);
const fastStore = readFileSync(
  new URL('../worker/src/minute-facts-fast-store.js', import.meta.url),
  'utf8',
);
const collectorEntry = readFileSync(
  new URL('../worker/src/buddies-collector-entry.js', import.meta.url),
  'utf8',
);

function repositoryFile(relativePath) {
  return new URL(`../${relativePath}`, import.meta.url);
}

test('dashboard is published directly from committed live minute facts', () => {
  assert.match(fastStore, /await timedStage\('upsert_minute_fact'/);
  assert.match(fastStore, /await publishCurrentDashboard\(env, input, fact\)/);
  assert.match(livePublisher, /export async function publishDashboardFromMinuteFact/);
  assert.match(livePublisher, /pages_dashboard_live_published/);
  assert.match(livePublisher, /bucket\.put\(DASHBOARD_KEY/);
});

test('dashboard no longer depends on GitHub Actions or a dispatch watchdog', () => {
  assert.equal(existsSync(repositoryFile('.github/workflows/refresh-pages-realtime.yml')), false);
  assert.equal(existsSync(repositoryFile('.github/workflows/sync-pages-realtime-watchdog-secret.yml')), false);
  assert.equal(existsSync(repositoryFile('worker/src/pages-realtime-read-model-watchdog.js')), false);
  assert.equal(existsSync(repositoryFile('worker/scripts/refresh-pages-realtime-actions.mjs')), false);
  assert.doesNotMatch(collectorEntry, /PagesRealtimeReadModelWatchdog|PAGES_READ_MODEL_DISPATCH_TOKEN/);
  assert.doesNotMatch(livePublisher, /api\.github\.com|workflow.*dispatch/i);
});
