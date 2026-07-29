import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const rollout = readFileSync(
  new URL('../.github/workflows/native-update-rollout.yml', import.meta.url),
  'utf8',
);
const scheduler = readFileSync(
  new URL('../hp/cloud/src/scheduler_runtime.ts', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL('../hp/cloud/migrations/202607291600_update_check_30m.sql', import.meta.url),
  'utf8',
);

test('successful main native builds trigger update detection without a configured Worker URL', () => {
  assert.match(rollout, /workflow_run:/);
  assert.match(rollout, /Native Windows Build/);
  assert.match(rollout, /workflow_run\.conclusion == 'success'/);
  assert.match(rollout, /workflow_run\.head_branch == 'main'/);
  assert.match(rollout, /cloudflare-worker-public-url\.mjs homepanel-cloud/);
  assert.match(rollout, /\/v1\/update\/ping/);
  assert.match(rollout, /status !== 202/);
  assert.match(rollout, /payload\?\.queued !== true/);
  assert.doesNotMatch(rollout, /HOMEPANEL_WORKER_URL/);
});

test('thirty-minute cadence is applied to D1 and reloaded by the scheduler runtime', () => {
  assert.match(migration, /interval_seconds = 1800/);
  assert.match(migration, /unixepoch\(\) \+ 1800/);
  assert.match(scheduler, /RUNTIME_VERSION = 6/);
  assert.match(scheduler, /return migrateRuntime\(state, env, stored, nowSeconds\)/);
});

test('one-time recovery workflows are absent from the permanent change', () => {
  assert.equal(
    existsSync(new URL('../.github/workflows/one-time-recover-23h-native-update.yml', import.meta.url)),
    false,
  );
  assert.equal(
    existsSync(new URL('../.github/workflows/one-time-prepare-native-update-fix.yml', import.meta.url)),
    false,
  );
});
