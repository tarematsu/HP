import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync(new URL('../functions/api/dashboard.js', import.meta.url), 'utf8');
const dashboardDetails = readFileSync(new URL('../functions/api/dashboard-details.js', import.meta.url), 'utf8');
const stationheadProxy = readFileSync(new URL('../functions/lib/stationhead-materialized-proxy.js', import.meta.url), 'utf8');
const readModelService = readFileSync(new URL('../functions/lib/pages-read-model-service.js', import.meta.url), 'utf8');
const publisher = readFileSync(new URL('../../worker/src/pages-dashboard-live-publisher.js', import.meta.url), 'utf8');
const stationheadState = readFileSync(new URL('../../worker/src/stationhead-read-model-state.js', import.meta.url), 'utf8');
const sourceProfile = readFileSync(new URL('../../packages/sh-shared/stationhead-source.mjs', import.meta.url), 'utf8');

test('Pages dashboard boundary is materialized-service only', () => {
  assert.match(dashboard, /proxyStationheadMaterializedReadModel/);
  assert.match(stationheadProxy, /fetchPagesReadModel/);
  assert.match(stationheadProxy, /stationheadReadModelKey/);
  assert.match(readModelService, /PAGES_READ_MODEL_SERVICE/);
  assert.match(readModelService, /_internal\/pages-response/);
  assert.doesNotMatch(dashboard, /MINUTE_DB|OTHER_DB|DB|\.prepare\(/);
  assert.doesNotMatch(dashboardDetails, /MINUTE_DB|OTHER_DB|\.prepare\(|FROM sh_/);
});

test('Worker owns dashboard generation and R2 publication', () => {
  assert.match(publisher, /publishStationheadReadModel\(bucket, 'buddies'/);
  assert.match(stationheadState, /saveMaterializedR2Response/);
  assert.match(publisher, /loadDashboardDailySummaries/);
  assert.match(publisher, /directFiveMinuteStreamHistory/);
  assert.match(publisher, /dashboardGoalPredictions/);
  assert.match(publisher, /DASHBOARD_MODEL_KEY/);
});

test('Stationhead source profile owns the public dashboard model identity', () => {
  assert.match(sourceProfile, /buddies:[\s\S]*modelKey: 'dashboard'/);
  assert.match(sourceProfile, /buddies:[\s\S]*publicationCadenceSeconds: 300/);
  assert.match(dashboard, /'buddies'/);
  assert.match(dashboardDetails, /stationheadReadModelKey\('buddies'\)/);
});
