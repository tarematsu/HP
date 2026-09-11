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

test('generic recovery state preserves active and failed runs instead of retrying them', () => {
  const active = workflowRunState([run({ minutesAgo: 80, status: 'in_progress', conclusion: '' })], {
    now,
    recoverAfterMs: 60 * 60_000,
  });
  assert.equal(active.state, 'active');
  assert.equal(active.startedAtMs, now - 80 * 60_000);

  const failed = workflowRunState([run({ minutesAgo: 80, conclusion: 'failure' })], {
    now,
    recoverAfterMs: 60 * 60_000,
  });
  assert.equal(failed.state, 'failed');
  assert.equal(failed.startedAtMs, now - 80 * 60_000);
});

test('recovery policy always leaves more than one watchdog interval before health stale', () => {
  assert.equal(RECOVERY_HEADROOM_MINUTES, 30);
  assert.equal(RECOVERY_WATCHDOG_INTERVAL_MINUTES, 15);
  for (const key of ['pages', 'runtime', 'metadata', 'localMinute']) {
    const definition = WORKFLOWS[key];
    assert.ok(definition.healthStaleAfterMs > definition.recoverAfterMs, key);
    assert.ok(
      definition.healthStaleAfterMs - definition.recoverAfterMs
        > RECOVERY_WATCHDOG_INTERVAL_MINUTES * 60_000,
      key,
    );
  }
});

test('stale Pages is recovered first without forcing all read models', async () => {
  const fixture = requestFor({ pages: 50, runtime: 80, metadata: 80, localMinute: 80 });
  const result = await recoverMaintenanceWorkflows({
    token: 'test-token',
    repository: 'tarematsu/HP',
    now,
    request: fixture.request,
  });
  assert.deepEqual(result.dispatched, ['pages']);
  assert.equal(result.reason, 'pages-recovered');
  const posts = fixture.calls.filter((call) => call.options.method === 'POST');
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /run-pages-read-model-rebuild\.yml\/dispatches$/);
  assert.deepEqual(posts[0].options.body, { ref: 'main', inputs: { force_all: 'false' } });
});

test('active or failed Pages blocks dependent Runtime recovery', async () => {
  for (const pages of [
    { minutesAgo: 80, status: 'in_progress', conclusion: '' },
    { minutesAgo: 80, conclusion: 'failure' },
  ]) {
    const fixture = requestFor({ pages, runtime: 80, metadata: 80, localMinute: 80 });
    const result = await recoverMaintenanceWorkflows({
      token: 'test-token',
      repository: 'tarematsu/HP',
      now,
      request: fixture.request,
    });
    assert.deepEqual(result.dispatched, []);
    assert.match(result.reason, /^pages-(active|failed)$/);
    assert.equal(fixture.calls.some((call) => call.options.method === 'POST'), false);
  }
});

test('stale Runtime is recovered when Pages is fresh', async () => {
  const fixture = requestFor({ pages: 10, runtime: 50, metadata: 80, localMinute: 80 });
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

test('fresh Runtime independently recovers stale metadata and local minute workflows', async () => {
  const fixture = requestFor({ pages: 10, runtime: 10, metadata: 50, localMinute: 35 });
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

test('single recovery watchdog resumes the dependency chain after Pages and Runtime complete', () => {
  const workflow = read('.github/workflows/recover-maintenance-workflows.yml');

  assert.match(workflow, /- "Publish GitHub Actions runner health"/);
  assert.match(workflow, /- "Rebuild pages read models"/);
  assert.match(workflow, /- "Run runtime offline maintenance"/);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
});

test('recovery watchdog is offset, budget-safe, and wired to shared policy', () => {
  const workflow = read('.github/workflows/recover-maintenance-workflows.yml');
  const script = read('.github/scripts/recover-maintenance-workflows.mjs');

  assert.match(workflow, /cron: '10,25,40,55 \* \* \* \*'/);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /actions\/setup-node@v7/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /maintenance-workflow-recovery/);
  assert.match(workflow, /workflow-health-policy\.mjs/);
  assert.doesNotMatch(workflow, /CLOUDFLARE|wrangler|d1 execute/i);

  assert.match(script, /RECOVERY_WORKFLOWS/);
  assert.match(script, /force_all: 'false'/);
  assert.match(script, /pages-\$\{states\.pages\.state\}/);
  assert.match(script, /runtime\.startedAtMs > observability\.startedAtMs/);
  assert.doesNotMatch(script, /45 \* 60_000|30 \* 60_000|75 \* 60_000/);
});
