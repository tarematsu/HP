import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const retiredScheduledCollectionWorkflows = [
  '.github/workflows/collect-kugou-acg-chart.yml',
  '.github/workflows/collect-regional-music-r2.yml',
  '.github/workflows/stationhead-daily-followers.yml',
  '.github/workflows/collect-qq-japan-toplist.yml',
  '.github/workflows/collect-qq-anime-toplist.yml',
  '.github/workflows/refresh-music-service-playlists.yml',
  '.github/workflows/refresh-amazon-music-track-playlists.yml',
];

test('scheduled collection GitHub Actions stay retired after Worker cutover', () => {
  for (const path of retiredScheduledCollectionWorkflows) {
    assert.equal(existsSync(new URL(path, root)), false, path);
  }

  const leaderboard = read('.github/workflows/stationhead-leaderboard-probe-report.yml');
  assert.match(leaderboard, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(leaderboard, /^\s*schedule:\s*$/m);
  assert.doesNotMatch(leaderboard, /import-stationhead-weekly-leaderboard-actions/);

  const kkboxBackfill = read('.github/workflows/backfill-kkbox-japanese-history-once.yml');
  assert.match(kkboxBackfill, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(kkboxBackfill, /^\s*schedule:\s*$/m);
  assert.doesNotMatch(kkboxBackfill, /^\s*push:\s*$/m);
});

test('shared dispatcher owns collection timing without owning collection data', () => {
  const dispatcher = JSON.parse(read('worker/wrangler.cron-dispatcher.jsonc'));
  assert.deepEqual(dispatcher.triggers?.crons, ['* * * * *']);
  assert.equal(dispatcher.d1_databases, undefined);
  assert.equal(dispatcher.r2_buckets, undefined);
  assert.equal(dispatcher.queues, undefined);
  assert.ok(dispatcher.services.some((binding) => binding.service === 'sh-scheduled-collection-jobs'));
  assert.ok(dispatcher.services.some((binding) => binding.service === 'sh-regional-music-collector'));
  assert.ok(dispatcher.services.some((binding) => binding.service === 'sh-amazon-music-collector'));
});

test('Sakurazaka and Buddies remain the only standalone collection cron owners', () => {
  const sakurazaka = JSON.parse(read('worker/wrangler.sakurazaka46jp.jsonc'));
  const buddies = JSON.parse(read('worker/wrangler.buddies-collector.jsonc'));
  const scheduledJobs = JSON.parse(read('worker/wrangler.scheduled-collection-jobs.jsonc'));
  const amazon = JSON.parse(read('worker/wrangler.amazon-music.jsonc'));
  const regional = JSON.parse(read('worker/wrangler.regional-music.jsonc'));

  assert.deepEqual(sakurazaka.triggers?.crons, ['* * * * *']);
  assert.deepEqual(buddies.triggers?.crons, ['*/5 * * * *']);
  assert.equal(scheduledJobs.triggers, undefined);
  assert.equal(amazon.triggers, undefined);
  assert.equal(regional.triggers, undefined);
});

test('high-frequency status workflows are event-driven instead of cron-polled', () => {
  for (const path of [
    '.github/workflows/recover-maintenance-workflows.yml',
    '.github/workflows/publish-github-deployment-health.yml',
    '.github/workflows/publish-github-actions-runner-health.yml',
  ]) {
    const workflow = read(path);
    assert.doesNotMatch(workflow, /^\s*schedule:\s*$/m, path);
    assert.match(workflow, /workflow_run:/, path);
  }
});
