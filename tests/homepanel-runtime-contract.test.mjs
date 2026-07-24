import assert from 'node:assert/strict';
import test from 'node:test';

import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';

test('HomePanel unified runtime keeps storage and scheduler fast paths', () => {
  const unifiedWorker = readSource('hp/cloud/src/unified_worker.js');
  const workerEntry = readSource('hp/cloud/src/worker_entry.ts');
  const workerCore = readSource('hp/cloud/src/worker_core.ts');
  const deviceSync = readSource('hp/cloud/src/device_sync.ts');
  const scheduler = readSource('hp/cloud/src/scheduler.ts');
  const schedulerRuntime = readSource('hp/cloud/src/scheduler_runtime.ts');
  const octopusHistory = readSource('hp/cloud/src/octopus_history.ts');
  const radarSource = readSource('hp/cloud/src/radar_source.ts');
  const radarCache = readSource('hp/cloud/src/radar_bundle_cache.ts');

  expectAll(unifiedWorker, [
    'async scheduled(_controller, env, ctx)',
    'queueSchedulerWatchdog(env, ctx)',
  ]);
  assert.ok(!unifiedWorker.includes('runSchedulerTick'));
  expectAll(radarSource, ['await prewarmRadarBundle(env, payload']);
  expectAll(radarCache, ['cache.match(cacheKey)', 'bucket.get(R2_LATEST_BUNDLE_KEY)']);
  expectNone(workerEntry + workerCore, [
    'legacy-telemetry-endpoint-used',
    'receiveTelemetryOptimized',
  ]);
  expectAll(deviceSync, [
    'FROM sync_manifest AS manifest',
    ').first<DeviceSyncSnapshotRow>()',
  ]);
  expectAll(schedulerRuntime, [
    'RUNTIME_STORAGE_KEY',
    'state.storage.put(RUNTIME_STORAGE_KEY',
    'INSERT INTO job_events',
  ]);
  expectAll(scheduler, [
    'refreshStatusCounts(env.DB',
    'SYSTEM_JOBS_CACHE_MS = 60 * 60_000',
  ]);
  expectAll(octopusHistory, ['octopus_daily_totals', 'readDailyRange']);
});
