import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cloudConfig = JSON.parse(readFileSync(new URL('../../cloud/wrangler.jsonc', import.meta.url), 'utf8'));
const videoConfig = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const nativeConfig = readFileSync(new URL('../../native/src/config.h', import.meta.url), 'utf8');
const nativeCloudConfig = readFileSync(new URL('../../native/src/cloud_config.cpp', import.meta.url), 'utf8');
const adminPage = readFileSync(new URL('../../cloud/src/admin.ts', import.meta.url), 'utf8');
const deviceExchange = readFileSync(new URL('../../cloud/src/device_exchange.ts', import.meta.url), 'utf8');
const deviceSync = readFileSync(new URL('../../cloud/src/device_sync.ts', import.meta.url), 'utf8');
const deviceSyncCoordinator = readFileSync(new URL('../../cloud/src/device_sync_coordinator.ts', import.meta.url), 'utf8');
const schedulerCoordinator = readFileSync(new URL('../../cloud/src/scheduler_coordinator.ts', import.meta.url), 'utf8');
const schedulerRuntime = readFileSync(new URL('../../cloud/src/scheduler_runtime.ts', import.meta.url), 'utf8');
const telemetryHeartbeat = readFileSync(new URL('../../cloud/src/telemetry_heartbeat.ts', import.meta.url), 'utf8');
const feedCoordinator = readFileSync(new URL('../src/video-feed-coordinator.js', import.meta.url), 'utf8');
const feedSnapshot = readFileSync(new URL('../src/feed-snapshot.js', import.meta.url), 'utf8');
const playbackSync = readFileSync(new URL('../src/playback-feed-sync.js', import.meta.url), 'utf8');
const sourceStorage = readFileSync(new URL('../src/video-storage-statements.js', import.meta.url), 'utf8');
const livenessSchedule = readFileSync(new URL('../src/liveness-schedule.js', import.meta.url), 'utf8');
const livenessMonitor = readFileSync(new URL('../src/liveness-monitor.js', import.meta.url), 'utf8');

const DAY_SECONDS = 86_400;
const REQUEST_TARGET = 3_000;
const READ_TARGET = 10_000;
const scheduledIntervals = {
  switchbot: 900,
  stationhead: 900,
  stationhead_health: 1_800,
  news: 1_800,
  weather: 3_600,
  octopus: 43_200,
  update_check: 21_600,
  cleanup: 86_400,
};

function runsPerDay(intervalSeconds) {
  return Math.ceil(DAY_SECONDS / intervalSeconds);
}

function modeledSchedulerAlarms() {
  const alarmTimes = new Set();
  for (const interval of Object.values(scheduledIntervals)) {
    for (let next = 0; next < DAY_SECONDS; next += interval) alarmTimes.add(next);
  }
  return alarmTimes.size;
}

test('static video assets and Browser Rendering stay outside the gateway Worker', () => {
  assert.equal(cloudConfig.assets, undefined);
  assert.equal(cloudConfig.browser, undefined);
  assert.equal(cloudConfig.queues, undefined);
  assert.equal(cloudConfig.services?.[0]?.binding, 'VIDEO_SERVICE');
  assert.deepEqual(videoConfig.assets.run_worker_first, ['/api/*']);
  assert.equal(videoConfig.browser.binding, 'BROWSER');
  assert.equal(videoConfig.workers_dev, false);
});

test('each hot coordination workload has an independent Durable Object', () => {
  assert.ok(cloudConfig.durable_objects.bindings.some((entry) => entry.name === 'SCHEDULER_COORDINATOR'));
  assert.ok(cloudConfig.durable_objects.bindings.some((entry) => entry.name === 'DEVICE_SYNC_COORDINATOR'));
  assert.ok(cloudConfig.durable_objects.bindings.some((entry) => entry.name === 'RADAR_BUNDLE_COORDINATOR'));
  assert.ok(videoConfig.durable_objects.bindings.some((entry) => entry.class_name === 'VideoFeedCoordinator'));
  assert.match(feedCoordinator, /CANDIDATE_CHUNK_SIZE = 500/);
  assert.match(feedCoordinator, /EXPECTED_SCHEDULED_FEED_GROUPS = 2/);
  assert.match(feedCoordinator, /video-feed-stage/);
  assert.match(feedCoordinator, /video-feed-refresh/);
  assert.match(feedSnapshot, /SNAPSHOT_KEY = 'video\/playback-feed\/v1\.json'/);
});

test('native polling is fixed at thirty-minute sync and four-hour telemetry', () => {
  assert.match(nativeConfig, /cloudPollSeconds = 1800;/);
  assert.match(nativeConfig, /telemetryMinutes = 240;/);
  assert.match(nativeCloudConfig, /config\.cloudPollSeconds = 1800;/);
  assert.match(nativeCloudConfig, /config\.telemetryMinutes = 240;/);
  assert.match(adminPage, /cloudPollSeconds:1800,telemetryMinutes:240/);
});

test('HomePanel scheduler drains due work with bounded concurrency and aligned cadence', () => {
  assert.match(schedulerRuntime, /MAX_RUNTIME_BATCH = 3/);
  assert.match(schedulerRuntime, /MAX_RUNTIME_JOBS_PER_ALARM = 32/);
  assert.match(schedulerRuntime, /Promise\.all\(batch\.map/);
  assert.match(schedulerRuntime, /nextCadenceAt/);
  assert.match(schedulerRuntime, /recordJobEventsBestEffort/);
  assert.match(schedulerRuntime, /state\.storage\.put\(RUNTIME_STORAGE_KEY/);
  assert.doesNotMatch(schedulerRuntime, /UPDATE jobs SET/);
  assert.doesNotMatch(schedulerRuntime, /video_liveness/);
  assert.match(schedulerCoordinator, /async alarm\(\)/);
  assert.doesNotMatch(schedulerCoordinator, /video-feed-/);
});

test('device exchange isolates telemetry and uses a dedicated sync coordinator', () => {
  const telemetryAt = deviceExchange.indexOf('if (input.telemetry !== undefined)');
  const mergeAt = deviceExchange.indexOf('await applyTelemetry');
  const coordinatedAt = deviceExchange.indexOf('requestCoordinatedDeviceSync');
  const fallbackAt = deviceExchange.indexOf('buildDeviceSyncPayloadForDevice');
  assert.ok(telemetryAt >= 0);
  assert.ok(mergeAt > telemetryAt);
  assert.ok(coordinatedAt > mergeAt);
  assert.ok(fallbackAt > coordinatedAt);
  assert.match(deviceExchange, /device-exchange-telemetry-failed/);
  assert.match(deviceSync, /manifestOverride/);
  assert.match(deviceSyncCoordinator, /DEVICE_SYNC_MANIFEST_KEY/);
});

test('video liveness is hourly, bounded, and isolated from Cloudflare Cron', () => {
  assert.equal(videoConfig.triggers, undefined);
  assert.match(livenessSchedule, /LIVENESS_INTERVAL_SECONDS = 60 \* 60/);
  assert.match(livenessMonitor, /LIVENESS_BATCH_SIZE = 5/);
  assert.match(livenessMonitor, /PROBE_CONCURRENCY = 5/);
  assert.match(livenessMonitor, /video_liveness_bounds/);
});

test('video catalog writes only new or materially changed rows', () => {
  assert.doesNotMatch(sourceStorage, /videos\.last_seen_at < \?/);
  assert.match(sourceStorage, /videos\.media_url IS NOT excluded\.media_url/);
  assert.match(sourceStorage, /videos\.media_type IS NOT excluded\.media_type/);
  assert.doesNotMatch(playbackSync, /last_seen_at/);
  assert.match(playbackSync, /currentFeedRowsStatement/);
  assert.match(playbackSync, /replaceItems/);
  assert.match(playbackSync, /mergeItems/);
});

test('modeled background D1 reads remain below ten thousand rows per day', () => {
  const deviceSpecificRows = runsPerDay(1800) * 3;
  const manifestBootstrapAndInvalidationRows = 10;
  const livenessRows = runsPerDay(3600) * 7;
  const dailyFeedReconciliationRows = 4_000;
  const schedulerAndSourceRowsReserve = 1_000;
  const apiFallbackRowsReserve = 500;
  const modeledReads = deviceSpecificRows
    + manifestBootstrapAndInvalidationRows
    + livenessRows
    + dailyFeedReconciliationRows
    + schedulerAndSourceRowsReserve
    + apiFallbackRowsReserve;

  assert.equal(modeledReads, 5_822);
  assert.ok(modeledReads < READ_TARGET);
});

test('modeled daily Worker and internal DO invocations stay below target', () => {
  const nativeExchangeRequests = runsPerDay(1800);
  const deviceSyncDoRequests = nativeExchangeRequests;
  const telemetryUploadRequests = runsPerDay(240 * 60);
  const schedulerAlarmInvocations = modeledSchedulerAlarms();
  const schedulerEnsureSignals = telemetryUploadRequests;
  const videoLivenessInvocations = runsPerDay(3600);
  const videoFeedDoRequests = 4;
  const radarGenerationReserve = 50;
  const apiWebhookVideoReserve = 1_900;
  const modeledRequests = nativeExchangeRequests
    + deviceSyncDoRequests
    + telemetryUploadRequests
    + schedulerAlarmInvocations
    + schedulerEnsureSignals
    + videoLivenessInvocations
    + videoFeedDoRequests
    + radarGenerationReserve
    + apiWebhookVideoReserve;

  assert.ok(modeledRequests < REQUEST_TARGET);
});

test('high-frequency state writes remain checkpointed', () => {
  assert.match(telemetryHeartbeat, /HEARTBEAT_REFRESH_MS = 24 \* 60 \* 60_000/);
  assert.match(feedCoordinator, /VIDEO_FEED_COUNT_KEY/);
  assert.match(feedCoordinator, /state\.storage\.put/);
});
