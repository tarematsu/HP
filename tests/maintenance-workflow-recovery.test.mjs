import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  WORKFLOWS,
  recoverMaintenanceWorkflows,
  workflowRunState,
} from '../.github/scripts/recover-maintenance-workflows.mjs';

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
  localMinute = 10,
  observability = 10,
} = {}) {
  const calls = [];
  const specs = { pages, runtime, metadata, localMinute, observability };
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

test('generic state preserves active and failed runs instead of retrying them', () => {
  const active = workflowRunState([run({ minutesAgo: 80, status: 'in_progress', conclusion: '' })], {
    now,
    staleAfterMs: 60 * 60_000,
  });
  assert.equal(active.state, 'active');
  assert.equal(active.startedAtMs, now - 80 * 60_000);

  const failed = workflowRunState([run({ minutesAgo: 80, conclusion: 'failure' })], {
    now,
    staleAfterMs: 60 * 60_000,
  });
  assert.equal(failed.state, 'failed');
  assert.equal(failed.startedAtMs, now - 80 * 60_000);
});

test('stale Runtime is recovered when Pages is fresh', async () => {
  const fixture = requestFor({ pages: 10, runtime: 80, metadata: 80, localMinute: 80 });
  const result = await recoverMaintenanceWorkflows({
    token: 'test-token',
    repository: 'tarematsu/HP',
    now,
    request: fixture.request,
  });
  assert.deepEqual(result.dispatched, ['runtime']);
  assert.equal(result.reason, 'runtime-recovered');
  const posts = fixture.calls.filter((call) => call.options.method === 'POST');
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /run-runtime-offline-maintenance\.yml\/dispatches$/);
  assert.deepEqual(posts[0].options.body, { ref: 'main' });
});

test('stale Runtime waits when Pages itself needs recovery', async () => {
  const fixture = requestFor({ pages: 80, runtime: 80, metadata: 80, localMinute: 80 });
  const result = await recoverMaintenanceWorkflows({
    token: 'test-token',
    repository: 'tarematsu/HP',
    now,
    request: fixture.request,
  });
  assert.deepEqual(result.dispatched, []);
  assert.equal(result.reason, 'runtime-waits-for-pages-recovery');
  assert.equal(fixture.calls.some((call) => call.options.method === 'POST'), false);
});

test('fresh Runtime independently recovers stale metadata and local minute workflows', async () => {
  const fixture = requestFor({ pages: 10, runtime: 10, metadata: 80, localMinute: 80 });
  const result = await recoverMaintenanceWorkflows({
    token: 'test-token',
    repository: 'tarematsu/HP',
    now,
    request: fixture.request,
  });
  assert.deepEqual(result.dispatched, ['metadata', 'localMinute']);
  assert.equal(result.reason, 'downstream-recovered');
  const postUrls = fixture.calls
    .filter((call) => call.options.method === 'POST')
    .map((call) => call.url);
  assert.equal(postUrls.length, 2);
  assert.ok(postUrls.some((url) => /run-track-metadata-repair\.yml\/dispatches$/.test(url)));
  assert.ok(postUrls.some((url) => /run-local-minute-facts-rebuild\.yml\/dispatches$/.test(url)));
});

test('Runtime recovery refreshes an older failed observability diagnostic', async () => {
  const fixture = requestFor({
    runtime: 5,
    observability: { minutesAgo: 20, conclusion: 'failure' },
  });
  const result = await recoverMaintenanceWorkflows({
    token: 'test-token',
    repository: 'tarematsu/HP',
    now,
    request: fixture.request,
  });
  assert.deepEqual(result.dispatched, ['observabilityRefresh']);
  assert.equal(result.reason, 'observability-refresh-dispatched');
  const posts = fixture.calls.filter((call) => call.options.method === 'POST');
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /refresh-cloudflare-observability\.yml\/dispatches$/);
});

test('newer observability failures remain visible instead of being auto-retried', async () => {
  const fixture = requestFor({
    runtime: 20,
    observability: { minutesAgo: 5, conclusion: 'failure' },
  });
  const result = await recoverMaintenanceWorkflows({
    token: 'test-token',
    repository: 'tarematsu/HP',
    now,
    request: fixture.request,
  });
  assert.deepEqual(result.dispatched, []);
  assert.equal(result.reason, 'maintenance-fresh-or-visible');
});

test('stale observability is refreshed after Runtime is healthy', async () => {
  const fixture = requestFor({ runtime: 5, observability: 70 });
  const result = await recoverMaintenanceWorkflows({
    token: 'test-token',
    repository: 'tarematsu/HP',
    now,
    request: fixture.request,
  });
  assert.deepEqual(result.dispatched, ['observabilityRefresh']);
});

test('maintenance watchdog is independent, offset, and has no Cloudflare credentials', () => {
  const workflow = read('.github/workflows/recover-maintenance-workflows.yml');
  const script = read('.github/scripts/recover-maintenance-workflows.mjs');

  assert.match(workflow, /workflows: \["Publish GitHub Actions runner health"\]/);
  assert.match(workflow, /cron: '18,48 \* \* \* \*'/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /maintenance-workflow-recovery/);
  assert.doesNotMatch(workflow, /CLOUDFLARE|wrangler|d1 execute/i);

  assert.match(script, /run-pages-read-model-rebuild\.yml/);
  assert.match(script, /run-runtime-offline-maintenance\.yml/);
  assert.match(script, /run-track-metadata-repair\.yml/);
  assert.match(script, /run-local-minute-facts-rebuild\.yml/);
  assert.match(script, /sh-observability\.yml/);
  assert.match(script, /refresh-cloudflare-observability\.yml/);
  assert.match(script, /runtime-waits-for-pages-recovery/);
  assert.match(script, /runtime\.startedAtMs > observability\.startedAtMs/);
  assert.match(script, /state !== 'fresh'/);
});
