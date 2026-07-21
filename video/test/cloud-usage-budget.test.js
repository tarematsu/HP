import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cloudConfig = JSON.parse(readFileSync(new URL('../../cloud/wrangler.jsonc', import.meta.url), 'utf8'));
const nativeConfig = readFileSync(new URL('../../native/src/config.h', import.meta.url), 'utf8');
const nativeCloudConfig = readFileSync(new URL('../../native/src/cloud_config.cpp', import.meta.url), 'utf8');
const resourceMigration = readFileSync(
  new URL('../../cloud/migrations/202607220100_resource_budget_3000.sql', import.meta.url),
  'utf8'
);
const livenessSchedule = readFileSync(new URL('../src/liveness-schedule.js', import.meta.url), 'utf8');

const DAY_SECONDS = 86_400;
const TARGET = 3_000;
const STATE_HEARTBEAT_SECONDS = 60 * 60;
const scheduledIntervals = {
  switchbot: 900,
  stationhead: 900,
  stationhead_health: 1_800,
  news: 1_800,
  weather: 3_600,
  octopus: 21_600,
  video_liveness: 1_200,
  update_check: 21_600,
  cleanup: 86_400
};
const heartbeatStateIntervals = [900, 1_800, 1_800, 3_600, 21_600];

function runsPerDay(intervalSeconds) {
  return Math.ceil(DAY_SECONDS / intervalSeconds);
}

function throttledHeartbeatWrites(intervalSeconds) {
  const effectiveInterval = Math.ceil(STATE_HEARTBEAT_SECONDS / intervalSeconds) * intervalSeconds;
  return runsPerDay(effectiveInterval);
}

test('static assets bypass the Worker while dynamic routes remain Worker-first', () => {
  assert.deepEqual(cloudConfig.assets.run_worker_first, ['/api/*', '/v1/*', '/admin']);
  assert.notEqual(cloudConfig.assets.run_worker_first, true);
});

test('Workers KV is absent while bounded R2 caches remain declared', () => {
  assert.equal(cloudConfig.kv_namespaces, undefined);
  assert.ok(cloudConfig.r2_buckets.some((entry) => entry.binding === 'DATA_BUCKET'));
});

test('native polling is fixed at fifteen-minute sync and hourly telemetry', () => {
  assert.match(nativeConfig, /cloudPollSeconds = 900;/);
  assert.match(nativeConfig, /telemetryMinutes = 60;/);
  assert.match(nativeCloudConfig, /config\.cloudPollSeconds = 900;/);
  assert.match(nativeCloudConfig, /config\.telemetryMinutes = 60;/);
});

test('scheduler migration and liveness schedule use the reduced cadence', () => {
  for (const [name, interval] of Object.entries(scheduledIntervals)) {
    assert.match(resourceMigration, new RegExp(`WHEN '${name}' THEN ${interval}`));
  }
  assert.match(livenessSchedule, /LIVENESS_INTERVAL_SECONDS = 20 \* 60/);
});

test('modeled daily D1 writes stay below the 3000-row target', () => {
  const schedulerCompletionWrites = Object.values(scheduledIntervals)
    .reduce((total, interval) => total + runsPerDay(interval), 0);
  assert.equal(schedulerCompletionWrites, 393);

  const switchbotStateWrites = runsPerDay(scheduledIntervals.switchbot);
  const heartbeatStateWrites = heartbeatStateIntervals
    .reduce((total, interval) => total + throttledHeartbeatWrites(interval), 0);
  const stateWrites = switchbotStateWrites + heartbeatStateWrites;
  const compactTelemetryHeartbeatWrites = runsPerDay(60 * 60) * 2;
  const changeCommandWebhookAndLegacyReserve = 2_100;
  const modeledWrites = schedulerCompletionWrites
    + stateWrites
    + compactTelemetryHeartbeatWrites
    + changeCommandWebhookAndLegacyReserve;

  assert.equal(switchbotStateWrites, 96);
  assert.equal(heartbeatStateWrites, 100);
  assert.equal(stateWrites, 196);
  assert.equal(compactTelemetryHeartbeatWrites, 48);
  assert.equal(modeledWrites, 2_737);
  assert.ok(modeledWrites < TARGET);
});

test('modeled daily Worker invocations stay below the 3000-request target', () => {
  const nativeExchangeRequests = runsPerDay(900);
  const schedulerAlarmInvocations = Object.values(scheduledIntervals)
    .reduce((total, interval) => total + runsPerDay(interval), 0);
  const radarGenerationReserve = 50;
  const apiWebhookVideoAndLegacyReserve = 2_100;
  const modeledRequests = nativeExchangeRequests
    + schedulerAlarmInvocations
    + radarGenerationReserve
    + apiWebhookVideoAndLegacyReserve;

  assert.equal(nativeExchangeRequests, 96);
  assert.equal(schedulerAlarmInvocations, 393);
  assert.equal(modeledRequests, 2_639);
  assert.ok(modeledRequests < TARGET);
});

test('bounded R2 telemetry writes remain modest', () => {
  const telemetryStateAndLatestWrites = runsPerDay(60 * 60) * 2;
  const radarLatestReserve = 24;
  assert.equal(telemetryStateAndLatestWrites + radarLatestReserve, 72);
});
