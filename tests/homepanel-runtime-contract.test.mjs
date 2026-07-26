import assert from 'node:assert/strict';
import test from 'node:test';

import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';

test('HomePanel Cloud keeps a small gateway and isolated coordinators', () => {
  const unifiedWorker = readSource('hp/cloud/src/unified_worker.js');
  const workerCore = readSource('hp/cloud/src/worker_core.ts');
  const scheduler = readSource('hp/cloud/src/scheduler.ts');
  const schedulerRuntime = readSource('hp/cloud/src/scheduler_runtime.ts');
  const schedulerCoordinator = readSource('hp/cloud/src/scheduler_coordinator.ts');
  const deviceSyncCoordinator = readSource('hp/cloud/src/device_sync_coordinator.ts');
  const radarCoordinator = readSource('hp/cloud/src/radar_bundle_coordinator.ts');
  const cloudConfig = readSource('hp/cloud/wrangler.jsonc');
  const videoConfig = readSource('hp/video/wrangler.jsonc');
  const videoEntry = readSource('hp/video/src/entry.js');

  expectAll(unifiedWorker, [
    'env?.VIDEO_SERVICE',
    'videoService.fetch(internalVideoRequest(request))',
    "export { DeviceSyncCoordinator }",
    "export { RadarBundleCoordinator }",
  ]);
  expectNone(unifiedWorker, [
    "../../video/src/entry.js",
    'videoRuntimeActive',
    'async queue(',
    'async scheduled(',
  ]);

  expectAll(workerCore, [
    'path === "/v1/ready"',
    'path === "/v1/device/exchange"',
    'path.startsWith("/v1/radar/bundle/")',
    'path.startsWith("/v1/spotify/")',
  ]);
  expectNone(workerCore, ['worker.fetch(request, env, ctx)']);

  expectAll(schedulerRuntime, [
    'RUNTIME_STORAGE_KEY',
    'state.storage.put(RUNTIME_STORAGE_KEY',
    'INSERT INTO job_events',
  ]);
  expectNone(schedulerRuntime, [
    '../../video/',
    'runVideoLiveness',
    'DEVICE_SYNC_MANIFEST_KEY',
  ]);
  expectAll(scheduler, [
    'SYSTEM_JOBS_CACHE_MS = 60 * 60_000',
    "DELETE FROM jobs WHERE name IN ('radar_dispatch','video_liveness')",
  ]);
  expectNone(scheduler, [
    'acquireDueJobs',
    'finishJob',
    'runSchedulerTick',
    '../../video/',
  ]);

  expectAll(schedulerCoordinator, ['/ensure', '/wake', 'async alarm()']);
  expectNone(schedulerCoordinator, ['video-feed-', 'radar-bundle-shard', 'device-sync-invalidate']);
  expectAll(deviceSyncCoordinator, ['export class DeviceSyncCoordinator', 'DEVICE_SYNC_COORDINATOR']);
  expectAll(radarCoordinator, ['export class RadarBundleCoordinator', 'radarBundleShardResponse']);

  expectAll(cloudConfig, [
    '"binding": "VIDEO_SERVICE"',
    '"service": "homepanel-video"',
    '"class_name": "DeviceSyncCoordinator"',
    '"class_name": "RadarBundleCoordinator"',
  ]);
  expectNone(cloudConfig, ['"browser"', '"queues"', '"assets"']);
  expectAll(videoConfig, [
    '"name": "homepanel-video"',
    '"binding": "BROWSER"',
    '"queue": "videoscraper-manual-imports"',
    '"class_name": "VideoFeedCoordinator"',
  ]);
  expectAll(videoEntry, ['X-HomePanel-Internal-Service', "pathname === '/api/health'"]);
});

test('HomePanel deployment is direct and rollback-capable', () => {
  const packageJson = readSource('hp/cloud/package.json');
  const deployExisting = readSource('hp/cloud/scripts/deploy-existing.mjs');
  const deployWorkflow = readSource('.github/workflows/cloud-deploy.yml');
  const rollbackWorkflow = readSource('.github/workflows/homepanel-cloud-rollback.yml');

  expectAll(packageJson, [
    '"deploy": "node scripts/deploy-existing.mjs"',
    '"deploy:worker": "node scripts/deploy-existing.mjs --without-migrations"',
  ]);
  expectNone(packageJson, ['guarded-deploy', 'video_runtime_activation']);
  expectAll(deployExisting, [
    '--without-migrations',
    'Routine Worker deploy: skipping remote D1 migration discovery',
    'env: { ...process.env, CI: "true" }',
  ]);
  expectAll(deployWorkflow, [
    'Deploy private video service',
    'Deploy HomePanel gateway',
    'Verify deployed readiness',
  ]);
  expectAll(rollbackWorkflow, [
    'wrangler "${args[@]}"',
    'homepanel-video',
    'homepanel-cloud',
  ]);
  assert.ok(deployWorkflow.indexOf('Deploy private video service') < deployWorkflow.indexOf('Deploy HomePanel gateway'));
});
