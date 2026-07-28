import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';

test('HomePanel video runtime is integrated and bounded', () => {
  const unifiedEntry = readSource('hp/cloud/src/unified_worker.js');
  const videoEntry = readSource('hp/video/src/entry.js');
  const retiredEntry = readSource('hp/video/src/retired-entry.js');
  const coordinator = readSource('hp/video/src/video-feed-coordinator.js');
  const cloudConfig = readSource('hp/cloud/wrangler.jsonc');
  const retiredConfig = readSource('hp/video/wrangler.jsonc');
  const statusReport = readSource('hp/video/src/status-report.js');
  const statusLists = readSource('hp/video/src/status-lists.js');
  const liveness = readSource('hp/video/src/liveness-monitor.js');
  const schedule = readSource('hp/video/src/liveness-schedule.js');
  const migration = readSource('hp/video/MIGRATION.md');

  expectAll(unifiedEntry, [
    "import videoWorker from '../../video/src/entry.js'",
    "export { VideoFeedCoordinator } from '../../video/src/entry.js'",
    'SCHEDULER_COORDINATOR: env?.VIDEO_FEED_COORDINATOR',
    'videoWorker.fetch(',
    'videoWorker.queue(',
    'videoWorker.scheduled(',
  ]);
  expectAll(videoEntry, [
    "const INTERNAL_HEADER = 'X-HomePanel-Internal-Service'",
    "pathname === '/api/health'",
    'export { VideoFeedCoordinator }',
    'getByName(LIVENESS_COORDINATOR_NAME)',
    'video-liveness-run',
  ]);
  expectAll(coordinator, [
    "import { runLivenessMonitor } from './liveness-monitor.js'",
    "path === '/video-liveness-run'",
    'runLivenessMonitor(this.env)',
  ]);
  expectAll(cloudConfig, [
    '"name": "homepanel-cloud"',
    '"directory": "../video/public"',
    '"binding": "BROWSER"',
    '"queue": "videoscraper-manual-imports"',
    '"name": "VIDEO_FEED_COORDINATOR"',
    '"class_name": "VideoFeedCoordinator"',
    '"0 * * * *"',
  ]);
  expectNone(cloudConfig, ['"binding": "VIDEO_SERVICE"', '"service": "homepanel-video"']);
  expectAll(retiredConfig, [
    '"name": "homepanel-video"',
    '"main": "src/retired-entry.js"',
    '"workers_dev": false',
    '"crons": []',
  ]);
  expectNone(retiredConfig, ['"binding": "BROWSER"', '"queue": "videoscraper-manual-imports"', '"class_name": "VideoFeedCoordinator"']);
  expectAll(retiredEntry, ['status: 410', 'integrated into homepanel-cloud']);

  expectAll(statusReport, ['status-counts-stale-deferred-to-cleanup']);
  assert.ok(!statusReport.includes('refreshStatusCounts'));
  expectAll(statusLists, ['daily-cleanup']);
  assert.ok(!statusLists.includes('refreshStatusCounts'));
  expectAll(liveness, [
    'video_liveness_bounds',
    'LIVENESS_BATCH_SIZE = 5',
    'PROBE_CONCURRENCY = 5',
    "video.status = 'active'",
  ]);
  assert.ok(!liveness.includes('MAX(video.id)'));
  expectAll(schedule, [
    'LIVENESS_INTERVAL_SECONDS = 60 * 60',
    'low-CPU dispatcher',
    'VideoFeedCoordinator',
  ]);

  expectAll(migration, [
    'Imported into HP as: `hp/video/`',
    'Production Worker: `homepanel-cloud`',
    'Retired standalone Worker: `homepanel-video`',
    'The `VIDEO_SERVICE` Service Binding is removed',
    'interval: one hour',
    'batch size: five URLs',
    'at most 120 normal liveness probes per day',
    'deploys the integrated `homepanel-cloud` Worker',
  ]);
  expectNone(migration, [
    'after migration activation',
    'A D1 activation flag',
    'Private video Worker: `homepanel-video`',
  ]);
});

test('manual Video Queue provisioning shares the fail-closed Cloudflare context', () => {
  const queues = readSource('.github/workflows/video-provision-manual-import-queue.yml');
  const recovery = readSource('hp/video/scripts/push-manual-import-recovery.mjs');
  expectAll(queues, [
    'uses: ./.github/actions/cloudflare-context',
    'api-token: ${{ secrets.CLOUDFLARE_BUILDS_API_TOKEN }}',
  ]);
  expectNone(queues, [
    'Validate Cloudflare credentials',
    'unset CLOUDFLARE_ACCOUNT_ID',
    'npx --no-install wrangler whoami',
  ]);
  expectAll(recovery, [
    'CLOUDFLARE_ACCOUNT_ID',
    '/accounts/${accountId}/queues?per_page=100',
    '/accounts/${accountId}/queues/${queueId}/messages',
  ]);
  expectNone(recovery, [
    'async function accountIds',
    '/accounts?per_page=50',
  ]);
});

test('unified observability targets the active HomePanel Worker', async () => {
  for (const path of [
    '../.github/workflows/video-worker-cpu-report.yml',
    '../hp/video/scripts/report-worker-cpu.mjs',
    '../hp/video/scripts/report-worker-invocations.mjs',
    '../hp/video/test/worker-cpu-report.test.js',
    '../hp/video/test/worker-invocation-report.test.js',
    '../.github/workflows/hp-observability.yml',
  ]) {
    await assert.rejects(access(new URL(path, import.meta.url)), path);
  }
  const observability = readSource('.github/workflows/sh-observability.yml');
  expectAll(observability, [
    'CLOUDFLARE_WORKERS: sh-sakurazaka46jp,sh-buddies-collector,sh-runtime-orchestrator,homepanel-cloud',
    'hp/cloud/wrangler.jsonc',
    'VIDEO_FEED_COORDINATOR',
    'query-cloudflare-observability.py',
    'audit-deployed-cloudflare-telemetry.py',
    'workflow_dispatch:',
    'lookback_minutes:',
  ]);
  expectNone(observability, ['CLOUDFLARE_WORKERS: sh-sakurazaka46jp,sh-buddies-collector,sh-runtime-orchestrator,homepanel-cloud,homepanel-video']);
});

test('retired standalone video build diagnostics stay removed', async () => {
  await assert.rejects(
    access(new URL('../hp/video/.github/scripts/cloudflare-build-diagnostics.mjs', import.meta.url)),
  );
});
