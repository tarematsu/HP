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
  ACTIONS_RUNNER_TARGETS,
} from '../.github/scripts/github-actions-runner-health-current.mjs';
import {
  buildActionsRunnerHealthIssueBody,
} from '../.github/scripts/publish-github-actions-runner-health.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const NOW = Date.parse('2026-07-26T15:00:00.000Z');
const target = {
  name: 'Pages read models',
  workflow: 'run-pages-read-model-rebuild.yml',
  cadenceMinutes: 30,
  staleAfterMinutes: 75,
  stalledAfterMinutes: 25,
};

function run(overrides = {}) {
  return {
    id: 100,
    run_number: 20,
    html_url: 'https://github.com/tarematsu/HP/actions/runs/100',
    event: 'schedule',
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
    run({
      created_at: '2026-07-26T12:00:00.000Z',
      run_started_at: '2026-07-26T12:01:00.000Z',
      updated_at: '2026-07-26T12:03:00.000Z',
    }),
  ], { now: NOW });
  assert.equal(stale.health, 'stale');
});

test('a fresh rerun attempt is not stale because the original run was created earlier', () => {
  const rerun = run({
    created_at: '2026-07-26T12:00:00.000Z',
    run_started_at: '2026-07-26T14:57:00.000Z',
    updated_at: '2026-07-26T14:59:00.000Z',
  });
  const result = evaluateActionsRunnerHealth(target, [rerun], { now: NOW });
  assert.equal(result.health, 'healthy');
  assert.equal(result.latestAge, 3 * 60_000);
  const summary = renderActionsRunnerHealthSummary([result], { now: NOW });
  assert.match(summary, /3m ago/);
});

test('expected workflow-run skips can be ignored without hiding scheduled skips', () => {
  const skipTarget = { ...target, ignoreExpectedWorkflowRunSkips: true };
  const expectedSkip = run({
    id: 101,
    run_number: 21,
    event: 'workflow_run',
    conclusion: 'skipped',
    created_at: '2026-07-26T14:59:00.000Z',
    run_started_at: '2026-07-26T14:59:00.000Z',
    updated_at: '2026-07-26T14:59:01.000Z',
  });
  const ignored = evaluateActionsRunnerHealth(skipTarget, [expectedSkip, run()], { now: NOW });
  assert.equal(ignored.health, 'healthy');
  assert.equal(ignored.latest.id, 100);

  const scheduledSkip = evaluateActionsRunnerHealth(skipTarget, [
    { ...expectedSkip, event: 'schedule' },
    run(),
  ], { now: NOW });
  assert.equal(scheduledSkip.health, 'degraded');
  assert.equal(scheduledSkip.latest.id, 101);
});

test('runner health queries main workflow runs and renders actionable links', async () => {
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

test('current runner target set covers operational workflows and excludes redundant dispatch', () => {
  const byWorkflow = new Map(ACTIONS_RUNNER_TARGETS.map((entry) => [entry.workflow, entry]));
  for (const workflow of [
    'run-pages-read-model-rebuild.yml',
    'run-runtime-offline-maintenance.yml',
    'run-track-metadata-repair.yml',
    'run-local-minute-facts-rebuild.yml',
    'sh-observability.yml',
    'publish-github-deployment-health.yml',
    'publish-github-actions-runner-health.yml',
  ]) assert.ok(byWorkflow.has(workflow), workflow);
  assert.equal(byWorkflow.has('refresh-cloudflare-observability.yml'), false);
  assert.equal(byWorkflow.get('run-pages-read-model-rebuild.yml').cadenceMinutes, 30);
  assert.ok(byWorkflow.get('run-pages-read-model-rebuild.yml').staleAfterMinutes >= 60);
  assert.equal(new Set(ACTIONS_RUNNER_TARGETS.map((entry) => entry.workflow)).size, ACTIONS_RUNNER_TARGETS.length);
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

test('runner health publisher fits a replacement into a near-limit issue body', () => {
  const tail = '\nEND-OF-NEAR-LIMIT-DIAGNOSTICS';
  const existing = `${ACTIONS_RUNNER_HEALTH_START}\nold runner health\n${ACTIONS_RUNNER_HEALTH_END}`;
  const issueBody = `<!-- cloudflare-observability-status -->\n${'x'.repeat(64_300)}${tail}\n${existing}`;
  const summary = `### GitHub Actions runner health\n\n${'y'.repeat(MAX_ACTIONS_HEALTH_SUMMARY_CHARS + 500)}`;
  const body = buildActionsRunnerHealthIssueBody(issueBody, summary);

  assert.match(body, /END-OF-NEAR-LIMIT-DIAGNOSTICS/);
  assert.match(body, /### GitHub Actions runner health/);
  assert.match(body, /…truncated…/);
  assert.doesNotMatch(body, /old runner health/);
  assert.equal(body.match(new RegExp(ACTIONS_RUNNER_HEALTH_START, 'g')).length, 1);
  assert.ok(body.length <= 65_000);
});

test('lightweight status writers share a non-cancelling issue lock', () => {
  const workflows = [
    read('.github/workflows/publish-github-actions-runner-health.yml'),
    read('.github/workflows/publish-github-deployment-health.yml'),
  ];
  for (const workflow of workflows) {
    assert.match(workflow, /group: cloudflare-observability-status-issue/);
    assert.match(workflow, /cancel-in-progress: false/);
  }

  const observability = read('.github/workflows/sh-observability.yml');
  assert.doesNotMatch(observability, /group: cloudflare-observability-status-issue/);
  assert.doesNotMatch(observability, /cancel-in-progress:/);
});

test('lightweight workflow refreshes after operational workflows and synchronizes system status', () => {
  const workflow = read('.github/workflows/publish-github-actions-runner-health.yml');
  for (const name of [
    'Unified Cloudflare Observability',
    'Rebuild pages read models',
    'Run runtime offline maintenance',
    'Repair track metadata',
    'Run local minute facts rebuild',
    'Publish GitHub deployment health',
  ]) assert.match(workflow, new RegExp(name));
  assert.doesNotMatch(workflow, /Refresh Cloudflare observability/);
  assert.match(workflow, /github-actions-runner-health-current\.mjs/);
  assert.match(workflow, /observability-system-status\.mjs/);
  assert.match(workflow, /cron: '2,17,32,47 \* \* \* \*'/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /timeout-minutes: 5/);
  assert.match(workflow, /publish-github-actions-runner-health\.mjs/);
});
