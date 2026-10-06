import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const publisher = readFileSync(new URL('../src/pages-dashboard-live-publisher.js', import.meta.url), 'utf8');
const fastStore = readFileSync(new URL('../src/minute-facts-fast-store.js', import.meta.url), 'utf8');
const dashboardEntry = readFileSync(new URL('../../site/public/dashboard-metrics.js', import.meta.url), 'utf8');
const dashboardReadModel = readFileSync(new URL('../../site/public/stationhead/buddies-read-model.js', import.meta.url), 'utf8');

test('committed live minute facts immediately publish the current dashboard model', () => {
  assert.match(fastStore, /await timedStage\('upsert_minute_fact'/);
  assert.match(fastStore, /await publishCurrentDashboard\(env, input, fact\)/);
  assert.match(publisher, /pagesR2ResponseKey\('dashboard'\)/);
  assert.match(publisher, /BUDDIES_DASHBOARD_HOT_STATE_KEY/);
  assert.match(publisher, /saveHotState\(bucket, payload, now\)/);
  assert.match(publisher, /savePublicEnvelope\(bucket, payload, now\)/);
  assert.match(publisher, /directFiveMinuteStreamHistory\(history\)/);
});

test('steady-state live publication is differential and reads D1 only for bounded gap recovery', () => {
  assert.doesNotMatch(publisher, /FULL_REFRESH_MS|6 \* 60 \* 60_000/);
  assert.match(publisher, /INCREMENTAL_GAP_LIMIT_MS = 11 \* 60_000/);
  assert.match(publisher, /RECOVERY_GAP_LIMIT_MS = DAY_MS/);
  assert.match(publisher, /minute_at>\? AND minute_at<\?/);
  assert.match(publisher, /mode = 'recovery'/);
  assert.match(publisher, /mode = 'bootstrap'/);
  assert.match(publisher, /loadExistingState\(bucket\)/);
  assert.match(publisher, /saveHotState/);
  assert.doesNotMatch(publisher, /FROM sh_dashboard_history_5m/);
});

test('current-tab read model has no secondary details request when the materialized model embeds details', () => {
  assert.doesNotMatch(dashboardEntry, /dashboard-details-client\.js/);
  assert.doesNotMatch(dashboardReadModel, /\/api\/dashboard-details|dashboard:details/);
  assert.equal((dashboardReadModel.match(/\/api\/dashboard\?history=0/g) || []).length, 1);
});
