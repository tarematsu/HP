import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cloudConfig = JSON.parse(readFileSync(new URL('../../cloud/wrangler.jsonc', import.meta.url), 'utf8'));
const nativeConfig = readFileSync(new URL('../../native/src/config.h', import.meta.url), 'utf8');
const nativeCloudConfig = readFileSync(new URL('../../native/src/cloud_config.cpp', import.meta.url), 'utf8');
const adminPage = readFileSync(new URL('../../cloud/src/admin.ts', import.meta.url), 'utf8');
const deviceExchange = readFileSync(new URL('../../cloud/src/device_exchange.ts', import.meta.url), 'utf8');
const deviceSync = readFileSync(new URL('../../cloud/src/device_sync.ts', import.meta.url), 'utf8');
const schedulerCoordinator = readFileSync(new URL('../../cloud/src/scheduler_coordinator.ts', import.meta.url), 'utf8');
const schedulerRuntime = readFileSync(new URL('../../cloud/src/scheduler_runtime.ts', import.meta.url), 'utf8');
const livenessDoDb = readFileSync(new URL('../../cloud/src/liveness_do_db.ts', import.meta.url), 'utf8');
const telemetryHeartbeat = readFileSync(new URL('../../cloud/src/telemetry_heartbeat.ts', import.meta.url), 'utf8');
const feedSnapshot = readFileSync(new URL('../src/feed-snapshot.js', import.meta.url), 'utf8');
const playbackSync = readFileSync(new URL('../src/playback-feed-sync.js', import.meta.url), 'utf8');
const sourceStorage = readFileSync(new URL('../src/video-storage-statements.js', import.meta.url), 'utf8');
const resourceMigration = readFileSync(
  new URL('../../cloud/migrations/202607220100_resource_budget_3000.sql', import.meta.url),
  'utf8'
);
const octopusScheduleMigration = readFileSync(
  new URL('../../cloud/migrations/202607240100_octopus_daily_stable_only.sql', import.meta.url),
  'utf8'
);
const runtimeMigration = readFileSync(
  new URL('../../cloud/migrations/202607240200_d1_runtime_reduction.sql', import.meta.url),
  'utf8'
);
const runtimeBugfixMigration = readFileSync(
  new URL('../../cloud/migrations/202607240300_d1_runtime_bugfixes.sql', import.meta.url),
  'utf8'
);
const offloadMigration = readFileSync(
  new URL('../../cloud/migrations/202607240400_storage_tier_offload.sql', import.meta.url),
  'utf8'
);
const livenessSchedule = readFileSync(new URL('../src/liveness-schedule.js', import.meta.url), 'utf8');

const DAY_SECONDS = 86_400;
const TARGET = 3_000;
const READ_TARGET = 10_000;
const STATE_HEARTBEAT_SECONDS = 24 * 60 * 60;
const scheduledIntervals = {
  switchbot: 900,
  stationhead: 900,
  stationhead_health: 1_800,
  news: 1_800,
  weather: 3_600,
  octopus: 86_400,
  video_liveness: 3_600,
  update_check: 21_600,
  cleanup: 86_400
};
const heartbeatStateIntervals = [900, 1_800, 1_800, 3_600, 86_400];

function runsPerDay(intervalSeconds) {
  return Math.ceil(DAY_SECONDS / intervalSeconds);
}

function throttledHeartbeatWrites(intervalSeconds) {
  const effectiveInterval = Math.ceil(STATE_HEARTBEAT_SECONDS / intervalSeconds) * intervalSeconds;
  return runsPerDay(effectiveInterval);
}

function modeledSchedulerAlarms() {
  const alarmTimes = new Set();
  for (const interval of Object.values(scheduledIntervals)) {
    for (let next = 0; next < DAY_SECONDS; next += interval) alarmTimes.add(next);
  }
  return alarmTimes.size;
}

test('static assets bypass the Worker while dynamic routes remain Worker-first', () => {
  assert.deepEqual(cloudConfig.assets.run_worker_first, ['/api/*', '/v1/*', '/admin']);
  assert.notEqual(cloudConfig.assets.run_worker_first, true);
});

test('R2 and the existing scheduler Durable Object are the primary offload tiers', () => {
  assert.equal(cloudConfig.kv_namespaces, undefined);
  assert.ok(cloudConfig.r2_buckets.some((entry) => entry.binding === 'DATA_BUCKET'));
  assert.ok(cloudConfig.durable_objects.bindings.some((entry) => entry.name === 'SCHEDULER_COORDINATOR'));
  assert.match(feedSnapshot, /SNAPSHOT_KEY = 'video\/playback-feed\/v1\.json'/);
  assert.match(feedSnapshot, /globalThis\.caches\?\.default/);
  assert.match(schedulerCoordinator, /CANDIDATE_CHUNK_SIZE = 500/);
  assert.match(schedulerCoordinator, /EXPECTED_SCHEDULED_FEED_GROUPS = 2/);
  assert.match(schedulerCoordinator, /video-feed-stage/);
  assert.match(schedulerCoordinator, /video-feed-refresh/);
});

test('native polling is fixed at thirty-minute sync and four-hour telemetry', () => {
  assert.match(nativeConfig, /cloudPollSeconds = 1800;/);
  assert.match(nativeConfig, /telemetryMinutes = 240;/);
  assert.match(nativeCloudConfig, /config\.cloudPollSeconds = 1800;/);
  assert.match(nativeCloudConfig, /config\.telemetryMinutes = 240;/);
  assert.match(adminPage, /cloudPollSeconds:1800,telemetryMinutes:240/);
  assert.match(adminPage, /config\.cloudPollSeconds=1800;config\.telemetryMinutes=240/);
});

test('scheduler drains all due work with bounded concurrency and aligned cadence', () => {
  for (const [name, interval] of Object.entries(scheduledIntervals)) {
    if (name === 'octopus') {
      assert.match(octopusScheduleMigration, /interval_seconds = 86400/);
      assert.match(octopusScheduleMigration, /WHERE name = 'octopus'/);
      continue;
    }
    if (name === 'video_liveness') {
      assert.match(runtimeMigration, /interval_seconds=3600/);
      assert.match(runtimeMigration, /WHERE name='video_liveness'/);
      continue;
    }
    assert.match(resourceMigration, new RegExp(`WHEN '${name}' THEN ${interval}`));
  }
  assert.match(livenessSchedule, /LIVENESS_INTERVAL_SECONDS = 60 \* 60/);
  assert.match(schedulerRuntime, /MAX_RUNTIME_BATCH = 3/);
  assert.match(schedulerRuntime, /MAX_RUNTIME_JOBS_PER_ALARM = 32/);
  assert.match(schedulerRuntime, /Promise\.all\(batch\.map/);
  assert.match(schedulerRuntime, /nextCadenceAt/);
  assert.match(schedulerRuntime, /recordJobEventsBestEffort/);
  assert.match(schedulerRuntime, /state\.storage\.put\(RUNTIME_STORAGE_KEY/);
  assert.doesNotMatch(schedulerRuntime, /UPDATE jobs SET/);
});

test('device exchange merges telemetry before DO-coordinated sync', () => {
  const telemetryAt = deviceExchange.indexOf('if (input.telemetry !== undefined)');
  const mergeAt = deviceExchange.indexOf('await applyTelemetry');
  const coordinatedAt = deviceExchange.indexOf('requestCoordinatedDeviceSync');
  const fallbackAt = deviceExchange.indexOf('buildDeviceSyncPayloadForDevice');
  assert.ok(telemetryAt >= 0);
  assert.ok(mergeAt > telemetryAt);
  assert.ok(coordinatedAt > mergeAt);
  assert.ok(fallbackAt > coordinatedAt);
  assert.match(deviceSync, /manifestOverride/);
  assert.match(schedulerCoordinator, /DEVICE_SYNC_MANIFEST_KEY/);
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

test('high-frequency D1 state is checkpointed or suppressed', () => {
  assert.match(runtimeMigration, /CREATE TABLE jobs_v2[\s\S]*WITHOUT ROWID/);
  assert.match(runtimeMigration, /CREATE TABLE current_state_v2[\s\S]*WITHOUT ROWID/);
  assert.match(runtimeMigration, /CREATE TABLE device_heartbeats_v2[\s\S]*WITHOUT ROWID/);
  assert.match(runtimeBugfixMigration, /WHEN NEW\.source IN/);
  assert.match(telemetryHeartbeat, /HEARTBEAT_REFRESH_MS = 24 \* 60 \* 60_000/);
  assert.match(livenessDoDb, /D1_CHECKPOINT_MS = 24 \* 60 \* 60_000/);
  assert.match(offloadMigration, /skip_redundant_current_state_heartbeat/);
  assert.match(offloadMigration, /OLD\.fetched_at \+ 86400000/);
});

test('modeled daily D1 written rows remain low after R2 and DO offload', () => {
  const switchbotChangedStateReserve = 24;
  const heartbeatStateRows = heartbeatStateIntervals
    .reduce((total, interval) => total + throttledHeartbeatWrites(interval), 0);
  const compactTelemetryHeartbeatRows = 1;
  const livenessCheckpointRows = 1;
  const jobFailureRecoveryReserve = 4;
  const octopusDailyAndCursorRows = 3;
  const feedStateRows = 1;
  const collectionObservabilityReserve = 40;
  const commandWebhookAndMaterialVideoMutationReserve = 500;
  const modeledRows = switchbotChangedStateReserve
    + heartbeatStateRows
    + compactTelemetryHeartbeatRows
    + livenessCheckpointRows
    + jobFailureRecoveryReserve
    + octopusDailyAndCursorRows
    + feedStateRows
    + collectionObservabilityReserve
    + commandWebhookAndMaterialVideoMutationReserve;

  assert.equal(heartbeatStateRows, 5);
  assert.equal(modeledRows, 579);
  assert.ok(modeledRows < TARGET);
});

test('modeled background D1 reads remain below ten thousand rows per day', () => {
  const deviceSpecificRows = runsPerDay(1800) * 3;
  const manifestBootstrapAndInvalidationRows = 10;
  const livenessRows = runsPerDay(scheduledIntervals.video_liveness) * 7;
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
  const scheduledFeedDoRequests = 2;
  const stateInvalidationReserve = 12;
  const radarGenerationReserve = 50;
  const apiWebhookVideoReserve = 1_900;
  const modeledRequests = nativeExchangeRequests
    + deviceSyncDoRequests
    + schedulerAlarmInvocations
    + schedulerEnsureSignals
    + scheduledFeedDoRequests
    + stateInvalidationReserve
    + radarGenerationReserve
    + apiWebhookVideoReserve;

  assert.equal(telemetryUploadRequests, 6);
  assert.equal(schedulerAlarmInvocations, 96);
  assert.equal(modeledRequests, 2_162);
  assert.ok(modeledRequests < TARGET);
});

test('primary R2 writes remain bounded', () => {
  const telemetryStateWrites = runsPerDay(240 * 60);
  const radarLatestReserve = 24;
  const feedSnapshotWrites = 1;
  const primaryR2Writes = telemetryStateWrites + radarLatestReserve + feedSnapshotWrites;

  assert.equal(primaryR2Writes, 31);
});
