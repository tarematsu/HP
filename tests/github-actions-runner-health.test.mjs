import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ACTIONS_RUNNER_HEALTH_END,
  ACTIONS_RUNNER_HEALTH_START,
  MAX_ACTIONS_HEALTH_SUMMARY_CHARS,
  collectActionsRunnerHealth,
  evaluateActionsRunnerHealth,
  renderActionsRunnerHealthSummary,
  replaceActionsRunnerHealthSection,
} from '../.github/scripts/github-actions-runner-health.mjs';
import {
  buildActionsRunnerHealthIssueBody,
} from '../.github/scripts/publish-github-actions-runner-health.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const NOW = Date.parse('2026-07-26T15:00:00.000Z');
const target = {
  name: 'Pages read models',
  workflow: 'run-pages-read-model-rebuild.yml',
  cadenceMinutes: 15,
  staleAfterMinutes: 40,
  stalledAfterMinutes: 25,
};

function run(overrides = {}) {
  return {
    id: 100,
    run_number: 20,
    html_url: 'https://github.com/tarematsu/HP/actions/runs/100',
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-07-26T14:49:00.000Z',
    run_started_at: '2026-07-26T14:50:00.000Z',
    updated_at: '2026-07-26T14:53:00.000Z',
    ...overrides,
  };
}

test('runner health classifies fresh, running, failed, stalled, and stale operational runs', () => {
  const healthy = evaluateActionsRunnerHealth(target, [run()], { now: NOW });
  assert.equal(healthy.health, 'healthy');
  assert.equal(healthy.durationMs, 180_000);
  assert.equal(healthy.consecutiveFailures, 0);

  const running = evaluateActionsRunnerHealth(target, [
    run({ id: 101, run_number: 21, status: 'in_progress', conclusion: null, updated_at: null }),
    run({ created_at: '2026-07-26T14:34:00.000Z', updated_at: '2026-07-26T14:38:00.000Z' }),
  ], { now: NOW });
  assert.equal(running.health, 'running');

  const failed = evaluateActionsRunnerHealth(target, [
    run({ conclusion: 'failure' }),
    run({ created_at: '2026-07-26T14:34:00.000Z', updated_at: '2026-07-26T14:38:00.000Z' }),
  ], { now: NOW });
  assert.equal(failed.health, 'failure');
  assert.equal(failed.consecutiveFailures, 1);

  const stalled = evaluateActionsRunnerHealth(target, [
    run({
      status: 'in_progress',
      conclusion: null,
      created_at: '2026-07-26T13:00:00.000Z',
      run_started_at: '2026-07-26T13:01:00.000Z',
      updated_at: null,
    }),
  ], { now: NOW });
  assert.equal(stalled.health, 'failure');
  assert.match(stalled.reason, /remained in_progress/);

  const stale = evaluateActionsRunnerHealth(target, [
    run({ created_at: '2026-07-26T13:00:00.000Z', updated_at: '2026-07-26T13:03:00.000Z' }),
  ], { now: NOW });
  assert.equal(stale.health, 'stale');
});

test('runner health queries all main workflow runs and renders actionable links', async () => {
  const calls = [];
  const results = await collectActionsRunnerHealth(async (method, path) => {
    calls.push([method, path]);
    return { workflow_runs: [run()] };
  }, { now: NOW, targets: [target] });
  assert.deepEqual(calls, [[
    'GET',
    '/actions/workflows/run-pages-read-model-rebuild.yml/runs?branch=main&per_page=20',
  ]]);
  const summary = renderActionsRunnerHealthSummary(results, { now: NOW });
  assert.match(summary, /Overall:\*\* healthy/);
  assert.match(summary, /operational workflow runs/);
  assert.match(summary, /\[#20\]\(https:\/\/github\.com\/tarematsu\/HP\/actions\/runs\/100\) success/);
});

test('runner health marker is inserted once and replaced without erasing diagnostics', () => {
  const initial = '<!-- cloudflare-observability-status -->\n# Status\n\n### Active Worker deployments\nbody';
  const inserted = replaceActionsRunnerHealthSection(initial, '### GitHub Actions runner health\n\nfirst');
  assert.match(inserted, new RegExp(ACTIONS_RUNNER_HEALTH_START));
  assert.match(inserted, new RegExp(ACTIONS_RUNNER_HEALTH_END));
  assert.ok(inserted.indexOf(ACTIONS_RUNNER_HEALTH_START) < inserted.indexOf('### Active Worker deployments'));

  const replaced = replaceActionsRunnerHealthSection(inserted, '### GitHub Actions runner health\n\nsecond');
  assert.equal(replaced.match(new RegExp(ACTIONS_RUNNER_HEALTH_START, 'g')).length, 1);
  assert.doesNotMatch(replaced, /first/);
  assert.match(replaced, /second/);
  assert.match(replaced, /Active Worker deployments/);
});

test('runner health publisher reserves space without truncating existing diagnostics', () => {
  const tail = '\nEND-OF-CLOUDFLARE-DIAGNOSTICS';
  const issueBody = `<!-- cloudflare-observability-status -->\n${'x'.repeat(59_000)}${tail}`;
  const summary = `### GitHub Actions runner health\n\n${'y'.repeat(MAX_ACTIONS_HEALTH_SUMMARY_CHARS + 500)}`;
  const body = buildActionsRunnerHealthIssueBody(issueBody, summary);
  assert.match(body, /END-OF-CLOUDFLARE-DIAGNOSTICS/);
  assert.match(body, /…truncated…/);
  assert.ok(body.length > 60_000);
  assert.ok(body.length <= 65_000);
});

test('status writers share a non-cancelling issue lock', () => {
  const healthWorkflow = read('.github/workflows/publish-github-actions-runner-health.yml');
  const observabilityWorkflow = read('.github/workflows/sh-observability.yml');
  for (const workflow of [healthWorkflow, observabilityWorkflow]) {
    assert.match(workflow, /group: cloudflare-observability-status-issue/);
    assert.match(workflow, /cancel-in-progress: false/);
  }
});

test('lightweight workflow refreshes after observability publication and on schedule', () => {
  const workflow = read('.github/workflows/publish-github-actions-runner-health.yml');
  assert.match(workflow, /workflows: \["Unified Cloudflare Observability"\]/);
  assert.match(workflow, /cron: '2,17,32,47 \* \* \* \*'/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /timeout-minutes: 5/);
  assert.match(workflow, /publish-github-actions-runner-health\.mjs/);
});
