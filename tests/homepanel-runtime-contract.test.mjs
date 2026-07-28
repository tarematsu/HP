import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';

test('HomePanel Cloud owns the video runtime and keeps isolated coordinators', async () => {
  const unifiedWorker = readSource('hp/cloud/src/unified_worker.js');
  const workerCore = readSource('hp/cloud/src/worker_core.ts');
  const scheduler = readSource('hp/cloud/src/scheduler.ts');
  const schedulerRuntime = readSource('hp/cloud/src/scheduler_runtime.ts');
  const schedulerCoordinator = readSource('hp/cloud/src/scheduler_coordinator.ts');
  const deviceSyncCoordinator = readSource('hp/cloud/src/device_sync_coordinator.ts');
  const deviceSyncClient = readSource('hp/cloud/src/device_sync_coordinator_client.ts');
  const radarCoordinator = readSource('hp/cloud/src/radar_bundle_coordinator.ts');
  const cloudConfig = readSource('hp/cloud/wrangler.jsonc');
  const videoEntry = readSource('hp/video/src/entry.js');

  expectAll(unifiedWorker, [
    "import videoWorker from '../../video/src/entry.js'",
    'videoWorker.fetch(',
    "export { VideoFeedCoordinator }",
    'VIDEO_FEED_COORDINATOR',
    "export { DeviceSyncCoordinator }",
    "export { RadarBundleCoordinator }",
    'queue(batch, env, ctx)',
    'scheduled(controller, env, ctx)',
  ]);
  expectNone(unifiedWorker, [
    'env?.VIDEO_SERVICE',
    'videoService.fetch',
    'videoRuntimeActive',
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
  expectAll(deviceSyncCoordinator, ['export class DeviceSyncCoordinator', 'readDeviceSyncManifest']);
  expectNone(deviceSyncCoordinator, ['function coordinatorStub', 'DEVICE_SYNC_COORDINATOR?:']);
  expectAll(deviceSyncClient, [
    'DEVICE_SYNC_COORDINATOR?: DurableObjectNamespace',
    'requestCoordinatedDeviceSync',
    'invalidateCoordinatedDeviceSyncManifest',
  ]);
  expectAll(radarCoordinator, ['export class RadarBundleCoordinator', 'radarBundleShardResponse']);

  expectAll(cloudConfig, [
    '"directory": "../video/public"',
    '"binding": "BROWSER"',
    '"queue": "videoscraper-manual-imports"',
    '"name": "VIDEO_FEED_COORDINATOR"',
    '"class_name": "VideoFeedCoordinator"',
    '"class_name": "DeviceSyncCoordinator"',
    '"class_name": "RadarBundleCoordinator"',
    '"0 * * * *"',
  ]);
  expectNone(cloudConfig, ['"binding": "VIDEO_SERVICE"', '"service": "homepanel-video"']);
  expectAll(videoEntry, ['X-HomePanel-Internal-Service', "pathname === '/api/health'"]);
  await assert.rejects(access(new URL('../hp/video/wrangler.jsonc', import.meta.url)));
  await assert.rejects(access(new URL('../hp/video/src/retired-entry.js', import.meta.url)));
});

test('HomePanel deployment deletes the standalone Worker and rolls back only Cloud', () => {
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
    'Validate integrated HomePanel runtime',
    'Deploy HomePanel Cloud',
    'Delete retired homepanel-video Worker',
    'wrangler delete --name homepanel-video --force',
    'Verify deployed readiness',
  ]);
  expectAll(rollbackWorkflow, [
    'wrangler "${args[@]}"',
    'homepanel-cloud',
  ]);
  expectNone(rollbackWorkflow, ['homepanel-video', 'video_version', 'Roll back video service']);
  assert.ok(deployWorkflow.indexOf('Deploy HomePanel Cloud') < deployWorkflow.indexOf('Delete retired homepanel-video Worker'));
});
