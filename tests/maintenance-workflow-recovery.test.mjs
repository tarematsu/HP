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
  pages = 10,
  runtime = 10,
  metadata = 10,
  observability = 10,
} = {}) {
  const calls = [];
  const specs = { pages, runtime, metadata, observability };
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
  const active = workflowRunState([run({ minutesAgo: 80, status: 'in_progress', conclusion: '' })], {
    now,
    recoverAfterMs: 60 * 60_000,
  });
  assert.equal(active.state, 'active');
  const failed = workflowRunState([run({ minutesAgo: 80, conclusion: 'failure' })], {
    now,
    recoverAfterMs: 60 * 60_000,
  });
  assert.equal(failed.state, 'failed');
});

test('recovery policy leaves more than one watchdog interval before health stale', () => {
  assert.equal(RECOVERY_HEADROOM_MINUTES, 30);
  assert.equal(RECOVERY_WATCHDOG_INTERVAL_MINUTES, 15);
  for (const key of ['pages', 'runtime', 'metadata']) {
    const definition = WORKFLOWS[key];
    assert.ok(definition.healthStaleAfterMs > definition.recoverAfterMs, key);
    assert.ok(
      definition.healthStaleAfterMs - definition.recoverAfterMs
        > RECOVERY_WATCHDOG_INTERVAL_MINUTES * 60_000,
      key,
    );
  }
  assert.equal(WORKFLOWS.localMinute, undefined);
});

test('stale Runtime is recovered before stale Pages', async () => {
  const fixture = requestFor({ pages: 1490, runtime: 80, metadata: 80 });
  const result = await recoverMaintenanceWorkflows({
    token: 'test-token', repository: 'tarematsu/HP', now, request: fixture.request,
  });
  assert.deepEqual(result.dispatched, ['runtime']);
  assert.equal(result.reason, 'runtime-recovered');
  const posts = fixture.calls.filter((call) => call.options.method === 'POST');
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /run-runtime-offline-maintenance\.yml\/dispatches$/);
});

test('active or failed Runtime blocks Pages recovery', async () => {
  for (const runtime of [
    { minutesAgo: 80, status: 'in_progress', conclusion: '' },
    { minutesAgo: 80, conclusion: 'failure' },
  ]) {
    const fixture = requestFor({ pages: 1490, runtime, metadata: 80 });
    const result = await recoverMaintenanceWorkflows({
      token: 'test-token', repository: 'tarematsu/HP', now, request: fixture.request,
    });
    assert.deepEqual(result.dispatched, []);
    assert.match(result.reason, /^runtime-(active|failed)$/);
  }
});

test('stale daily Pages recovery sweep is fully regenerated when Runtime is fresh', async () => {
  const fixture = requestFor({ pages: 1480, runtime: 10, metadata: 80 });
  const result = await recoverMaintenanceWorkflows({
    token: 'test-token', repository: 'tarematsu/HP', now, request: fixture.request,
  });
  assert.deepEqual(result.dispatched, ['pages']);
  assert.equal(result.reason, 'pages-recovered');
  const posts = fixture.calls.filter((call) => call.options.method === 'POST');
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /run-pages-read-model-rebuild\.yml\/dispatches$/);
  assert.deepEqual(posts[0].options.body, { ref: 'main', inputs: { force_all: 'true' } });
});

test('fresh Runtime and Pages recover metadata only; full minute rebuild stays manual', async () => {
  const fixture = requestFor({ pages: 5, runtime: 10, metadata: 50 });
  const result = await recoverMaintenanceWorkflows({
    token: 'test-token', repository: 'tarematsu/HP', now, request: fixture.request,
  });
  assert.deepEqual(result.dispatched, ['metadata']);
  const postUrls = fixture.calls
    .filter((call) => call.options.method === 'POST')
    .map((call) => call.url);
  assert.equal(postUrls.length, 1);
  assert.match(postUrls[0], /run-track-metadata-repair\.yml\/dispatches$/);
  assert.equal(postUrls.some((url) => /run-local-minute-facts-rebuild\.yml/.test(url)), false);
});

test('Runtime recovery refreshes an older failed observability diagnostic', async () => {
  const fixture = requestFor({
    pages: 5,
    runtime: 5,
    observability: { minutesAgo: 20, conclusion: 'failure' },
  });
  const result = await recoverMaintenanceWorkflows({
    token: 'test-token', repository: 'tarematsu/HP', now, request: fixture.request,
  });
  assert.deepEqual(result.dispatched, ['observabilityRefresh']);
  const posts = fixture.calls.filter((call) => call.options.method === 'POST');
  assert.match(posts[0].url, /refresh-cloudflare-observability\.yml\/dispatches$/);
});

test('maintenance workflows use published-revision drift dispatch and daily Pages fallback', () => {
  const watchdog = read('.github/workflows/recover-maintenance-workflows.yml');
  const runtimeWorkflow = read('.github/workflows/run-runtime-offline-maintenance.yml');
  const pagesWorkflow = read('.github/workflows/run-pages-read-model-rebuild.yml');
  const localRebuild = read('.github/workflows/run-local-minute-facts-rebuild.yml');
  const summaryRepairWorkflow = read('.github/workflows/repair-pages-summaries.yml');

  assert.match(watchdog, /- "Rebuild pages read models"/);
  assert.match(watchdog, /- "Run runtime offline maintenance"/);
  assert.doesNotMatch(watchdog, /run-local-minute-facts-rebuild\.yml/);
  assert.match(runtimeWorkflow, /^\s*workflows: \["Deploy production"\]\s*$/m);
  assert.match(runtimeWorkflow, /pages-revision-drift/);
  assert.match(runtimeWorkflow, /detect-pages-read-model-revision-drift-actions\.mjs/);
  assert.match(runtimeWorkflow, /run-minute-facts-gap-scan-actions\.mjs/);
  assert.doesNotMatch(pagesWorkflow, /workflow_run:/);
  assert.match(pagesWorkflow, /cron: '26 0 \* \* \*'/);
  assert.match(pagesWorkflow, /PAGES_READ_MODEL_DUE_KEYS/);
  assert.match(localRebuild, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(localRebuild, /^\s*schedule:\s*$/m);
  assert.match(summaryRepairWorkflow, /cron: '23 4 \* \* \*'/);
});

test('recovery watchdog remains offset and budget-safe', () => {
  const workflow = read('.github/workflows/recover-maintenance-workflows.yml');
  const script = read('.github/scripts/recover-maintenance-workflows.mjs');

  assert.match(workflow, /cron: '10,25,40,55 \* \* \* \*'/);
  assert.match(workflow, /actions: write/);
  assert.doesNotMatch(workflow, /CLOUDFLARE|wrangler|d1 execute/i);
  assert.match(script, /RECOVERY_WORKFLOWS/);
  assert.match(script, /force_all: 'true'/);
  assert.doesNotMatch(script, /localMinute/);
  assert.match(script, /runtime\.startedAtMs > observability\.startedAtMs/);
});
