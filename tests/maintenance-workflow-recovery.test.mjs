import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  WORKFLOWS,
  recoverMaintenanceWorkflows,
  workflowRunState,
} from '../.github/scripts/recover-maintenance-workflows.mjs';
import {
  RECOVERY_HEADROOM_MINUTES,
  RECOVERY_WATCHDOG_INTERVAL_MINUTES,
} from '../.github/scripts/workflow-health-policy.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const now = Date.parse('2026-09-01T00:00:00Z');

function run({ minutesAgo, status = 'completed', conclusion = 'success', id = 1 }) {
  return {
    id,
    status,
    conclusion,
    run_started_at: new Date(now - minutesAgo * 60_000).toISOString(),
  };
}

function runSpec(value) {
  return typeof value === 'number' ? { minutesAgo: value } : value;
}

function requestFor({
  runtime = 10,
  dataRepair = 10,
  dailyDeep = 10,
  metadata = 10,
  observability = 10,
} = {}) {
  const calls = [];
  const specs = { runtime, dataRepair, dailyDeep, metadata, observability };
  const byFile = Object.fromEntries(Object.entries(WORKFLOWS).map(([key, definition]) => [definition.file, key]));
  return {
    calls,
    async request(url, options = {}) {
      calls.push({ url, options });
      if (options.method === 'POST') return null;
      const file = decodeURIComponent(url.match(/actions\/workflows\/([^/]+)\/runs/)?.[1] || '');
      const key = byFile[file];
      assert.ok(key, `unexpected workflow URL: ${url}`);
      return { workflow_runs: [run(runSpec(specs[key]))] };
    },
  };
}

test('generic recovery state preserves active and failed runs instead of retrying them', () => {
  assert.equal(workflowRunState([run({ minutesAgo: 80, status: 'in_progress', conclusion: '' })], {
    now, recoverAfterMs: 60 * 60_000,
  }).state, 'active');
  assert.equal(workflowRunState([run({ minutesAgo: 80, conclusion: 'failure' })], {
    now, recoverAfterMs: 60 * 60_000,
  }).state, 'failed');
});

test('recovery policy leaves more than one watchdog interval before health stale', () => {
  assert.equal(RECOVERY_HEADROOM_MINUTES, 30);
  assert.equal(RECOVERY_WATCHDOG_INTERVAL_MINUTES, 15);
  for (const key of ['runtime', 'dataRepair', 'dailyDeep', 'metadata']) {
    const definition = WORKFLOWS[key];
    assert.ok(definition.healthStaleAfterMs > definition.recoverAfterMs, key);
    assert.ok(
      definition.healthStaleAfterMs - definition.recoverAfterMs
        > RECOVERY_WATCHDOG_INTERVAL_MINUTES * 60_000,
      key,
    );
  }
});

test('stale lightweight Runtime is recovered first', async () => {
  const fixture = requestFor({ runtime: 80, dataRepair: 320, dailyDeep: 1480, metadata: 1480 });
  const result = await recoverMaintenanceWorkflows({
    token: 'test-token', repository: 'tarematsu/HP', now, request: fixture.request,
  });
  assert.deepEqual(result.dispatched, ['runtime']);
  assert.equal(result.reason, 'runtime-recovered');
  const posts = fixture.calls.filter((call) => call.options.method === 'POST');
  assert.match(posts[0].url, /run-runtime-offline-maintenance\.yml\/dispatches$/);
});

test('stale four-hour data repair is recovered before daily deep repair', async () => {
  const fixture = requestFor({ runtime: 10, dataRepair: 310, dailyDeep: 1480, metadata: 1480 });
  const result = await recoverMaintenanceWorkflows({
    token: 'test-token', repository: 'tarematsu/HP', now, request: fixture.request,
  });
  assert.deepEqual(result.dispatched, ['dataRepair']);
  assert.equal(result.reason, 'data-repair-recovered');
  const posts = fixture.calls.filter((call) => call.options.method === 'POST');
  assert.match(posts[0].url, /run-data-integrity-repair\.yml\/dispatches$/);
});

test('active or failed data repair blocks downstream recovery', async () => {
  for (const dataRepair of [
    { minutesAgo: 310, status: 'in_progress', conclusion: '' },
    { minutesAgo: 310, conclusion: 'failure' },
  ]) {
    const fixture = requestFor({ runtime: 10, dataRepair, dailyDeep: 1480, metadata: 1480 });
    const result = await recoverMaintenanceWorkflows({
      token: 'test-token', repository: 'tarematsu/HP', now, request: fixture.request,
    });
    assert.deepEqual(result.dispatched, []);
    assert.match(result.reason, /^data-repair-(active|failed)$/);
  }
});

test('stale daily deep repair is recovered independently before metadata repair', async () => {
  const fixture = requestFor({ runtime: 10, dataRepair: 10, dailyDeep: 1480, metadata: 10 });
  const result = await recoverMaintenanceWorkflows({
    token: 'test-token', repository: 'tarematsu/HP', now, request: fixture.request,
  });
  assert.deepEqual(result.dispatched, ['dailyDeep']);
  assert.equal(result.reason, 'daily-deep-recovered');
  const posts = fixture.calls.filter((call) => call.options.method === 'POST');
  assert.match(posts[0].url, /run-daily-deep-repair\.yml\/dispatches$/);
});

test('failed daily deep repair remains visible and blocks downstream recovery', async () => {
  const fixture = requestFor({
    pages: 1490,
    runtime: 10,
    dataRepair: 10,
    dailyDeep: { minutesAgo: 1480, conclusion: 'failure' },
    metadata: 1480,
  });
  const result = await recoverMaintenanceWorkflows({
    token: 'test-token', repository: 'tarematsu/HP', now, request: fixture.request,
  });
  assert.deepEqual(result.dispatched, []);
  assert.equal(result.reason, 'daily-deep-failed');
});

test('fresh repair layers recover the daily metadata safety net only', async () => {
  const fixture = requestFor({ runtime: 10, dataRepair: 10, dailyDeep: 10, metadata: 1480 });
  const result = await recoverMaintenanceWorkflows({
    token: 'test-token', repository: 'tarematsu/HP', now, request: fixture.request,
  });
  assert.deepEqual(result.dispatched, ['metadata']);
  const postUrls = fixture.calls.filter((call) => call.options.method === 'POST').map((call) => call.url);
  assert.match(postUrls[0], /run-track-metadata-repair\.yml\/dispatches$/);
});

test('fresh repair layers allow an older failed observability diagnostic to refresh', async () => {
  const fixture = requestFor({
    runtime: 5, dataRepair: 5, dailyDeep: 5, metadata: 5,
    observability: { minutesAgo: 20, conclusion: 'failure' },
  });
  const result = await recoverMaintenanceWorkflows({
    token: 'test-token', repository: 'tarematsu/HP', now, request: fixture.request,
  });
  assert.deepEqual(result.dispatched, ['observabilityRefresh']);
});

test('maintenance workflows expose bounded four-hour repair and isolated daily deep reconciliation', () => {
  const watchdog = read('.github/workflows/recover-maintenance-workflows.yml');
  const runtimeWorkflow = read('.github/workflows/run-runtime-offline-maintenance.yml');
  const dataRepairWorkflow = read('.github/workflows/run-data-integrity-repair.yml');
  const dailyDeepWorkflow = read('.github/workflows/run-daily-deep-repair.yml');
  const metadataWorkflow = read('.github/workflows/run-track-metadata-repair.yml');

  assert.match(watchdog, /- "Run data integrity repair"/);
  assert.match(watchdog, /- "Run daily deep repair"/);
  assert.match(watchdog, /- "Repair track metadata"/);

  assert.match(runtimeWorkflow, /cron: '11,41 \* \* \* \*'/);
  assert.match(runtimeWorkflow, /RUNTIME_MAINTENANCE_COLLECTOR_ID: other-cron/);
  assert.match(runtimeWorkflow, /RUNTIME_MAINTENANCE_LIGHT_ONLY: 'true'/);
  assert.match(runtimeWorkflow, /RUNTIME_MAINTENANCE_SKIP_REBUILD: 'true'/);
  assert.doesNotMatch(runtimeWorkflow, /publish-recent-daily-summaries-actions\.mjs/);
  assert.doesNotMatch(runtimeWorkflow, /detect-pages-read-model-revision-drift-actions\.mjs/);
  assert.doesNotMatch(runtimeWorkflow, /run-minute-facts-gap-scan-actions\.mjs/);

  assert.match(dataRepairWorkflow, /cron: '31 \*\/4 \* \* \*'/);
  assert.match(dataRepairWorkflow, /run-minute-facts-gap-scan-actions\.mjs/);
  assert.match(dataRepairWorkflow, /RUNTIME_MAINTENANCE_COLLECTOR_ID: data-integrity-repair-actions/);
  assert.match(dataRepairWorkflow, /RUNTIME_MAINTENANCE_REBUILD_ONLY: 'true'/);
  assert.doesNotMatch(dataRepairWorkflow, /pages-revision-drift/);
  assert.doesNotMatch(dataRepairWorkflow, /publish-recent-daily-summaries-actions\.mjs/);

  assert.match(dailyDeepWorkflow, /cron: '46 0 \* \* \*'/);
  assert.match(dailyDeepWorkflow, /RUNTIME_MAINTENANCE_COLLECTOR_ID: daily-deep-repair-actions/);
  assert.match(dailyDeepWorkflow, /publish-recent-daily-summaries-actions\.mjs/);
  assert.doesNotMatch(dailyDeepWorkflow, /detect-pages-read-model-revision-drift-actions\.mjs|pages-revision-drift/);
  assert.match(dailyDeepWorkflow, /RUNTIME_MAINTENANCE_SKIP_REBUILD: 'true'/);

  assert.match(metadataWorkflow, /cron: '16 0 \* \* \*'/);
  assert.match(metadataWorkflow, /^\s*push:\s*$/m);
  assert.match(metadataWorkflow, /branches: \[main\]/);
  assert.match(metadataWorkflow, /worker\/scripts\/repair-playback-read-model-actions\.mjs/);
  assert.doesNotMatch(metadataWorkflow, /workflow_run:/);
});

test('recovery watchdog is event-driven and budget-safe', () => {
  const workflow = read('.github/workflows/recover-maintenance-workflows.yml');
  const script = read('.github/scripts/recover-maintenance-workflows.mjs');

  assert.match(workflow, /workflow_run:/);
  assert.doesNotMatch(workflow, /^\s*schedule:\s*$/m);
  assert.match(workflow, /actions: write/);
  assert.doesNotMatch(workflow, /CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)|wrangler|d1 execute/i);
  assert.match(script, /RECOVERY_WORKFLOWS/);
  assert.doesNotMatch(script, /WORKFLOWS\.pages|states\.pages|force_all/);
});
