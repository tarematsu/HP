import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';

test('HomePanel video runtime keeps deferred status and bounded liveness work', () => {
  const statusReport = readSource('hp/video/src/status-report.js');
  const statusLists = readSource('hp/video/src/status-lists.js');
  const liveness = readSource('hp/video/src/liveness-monitor.js');
  const schedule = readSource('hp/video/src/liveness-schedule.js');
  const migration = readSource('hp/video/MIGRATION.md');

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
  expectAll(schedule, ['LIVENESS_INTERVAL_SECONDS = 60 * 60']);
  expectAll(migration, [
    'Imported into HP as: `hp/video/`',
    'hp/cloud/src/unified_worker.js',
    'interval: one hour',
    'batch size: five URLs',
    'at most 120 normal liveness probes per day',
  ]);
  expectNone(migration, [
    'Imported into HP as: `video/`',
    'Original VP workflows remain',
    'interval: 12 minutes',
    'batch size: one URL',
  ]);
});

test('retired standalone video build diagnostics stay removed', async () => {
  await assert.rejects(
    access(new URL('../hp/video/.github/scripts/cloudflare-build-diagnostics.mjs', import.meta.url)),
  );
});
