import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildObservabilityTriage,
  deploymentSignal,
  diagnosticSectionTitle,
  extractViolationEvidence,
  observabilityIssueOverall,
  publicHealthSignal,
} from '../.github/scripts/observability-issue-triage.mjs';
import {
  ACTIONS_RUNNER_HEALTH_END,
  ACTIONS_RUNNER_HEALTH_START,
  extractActionsRunnerHealthBlock,
  replaceActionsRunnerHealthSection,
} from '../.github/scripts/github-actions-runner-health.mjs';
import { buildIssueBody } from '../.github/scripts/publish-cloudflare-observability-status.mjs';

const outcomes = {
  daily: 'failure',
  freeTier: 'failure',
  contract: 'success',
  d1Insights: 'success',
  query: 'success',
  telemetry: 'failure',
};
const summaries = {
  publicHealth: '| Endpoint | Result | HTTP |\n|---|---|---|\n| Unified health | success | 200 OK |',
  daily: '| Metric | Actual | Projected | Limit | Status |\n|---|---:|---:|---:|---|\n| D1 rows read | 17,570,384 | 28,470,606 | 5,000,000 | VIOLATION |',
  freeTier: '| Metric | Actual | Budget | Basis | Limit | Status |\n|---|---:|---:|---|---:|---|\n| queueOperations | 6,873 | 11,137 | 24h projection | 10,000 | VIOLATION |',
  telemetry: '## Current deployment\n\n- CPU policy failure: homepanel-cloud exceeded 10 ms',
};
const deployments = {
  'homepanel-cloud': { status: 'active', deployment_id: 'd1', version_ids: ['v1'] },
  'sh-runtime-orchestrator': { status: 'active', deployment_id: 'd2', version_ids: ['v2'] },
};

const allSuccessfulOutcomes = Object.fromEntries(Object.keys(outcomes).map((key) => [key, 'success']));

test('triage surfaces highest-priority failures and concrete budget evidence', () => {
  const triage = buildObservabilityTriage({
    outcomes,
    summaries,
    activeDeployments: deployments,
    runUrl: 'https://github.com/tarematsu/HP/actions/runs/1',
  });
  assert.match(triage, /ACTION REQUIRED — 3 active signals/);
  assert.match(triage, /Highest priority: \*\*Current-deployment telemetry policy\*\*/);
  assert.match(triage, /D1 rows read — 17,570,384 \/ 28,470,606 \/ 5,000,000/);
  assert.match(triage, /queueOperations — 6,873 \/ 11,137 \/ 24h projection/);
  assert.match(triage, /\| Public endpoint \| \*\*OK\*\*/);
  assert.match(triage, /#diagnostic-daily/);
  assert.match(triage, /workflow run/);
});

test('public health failure outranks budget findings and affects the Cloudflare status', () => {
  const failedPublicHealth = '| Endpoint | Result | HTTP |\n|---|---|---|\n| Unified health | failure | HTTP 503 |';
  const triage = buildObservabilityTriage({
    outcomes: { ...outcomes, telemetry: 'success' },
    summaries: { ...summaries, publicHealth: failedPublicHealth },
    activeDeployments: deployments,
  });
  assert.match(triage, /Highest priority: \*\*Public availability\*\*/);
  assert.match(triage, /\*\*P0\*\*/);
  assert.equal(publicHealthSignal(failedPublicHealth).state, 'failure');
  assert.equal(observabilityIssueOverall({
    outcomes: allSuccessfulOutcomes,
    summaries: { publicHealth: failedPublicHealth },
    activeDeployments: deployments,
  }), 'failure');
});

test('deployment signal fails closed for unavailable or incomplete inventory', () => {
  assert.equal(deploymentSignal({
    worker: { status: 'unavailable', deployment_id: '', version_ids: [] },
  }).state, 'failure');
  assert.equal(deploymentSignal({
    worker: { status: 'active', deployment_id: '', version_ids: [] },
  }).state, 'unknown');
  assert.equal(observabilityIssueOverall({
    outcomes: allSuccessfulOutcomes,
    summaries,
    activeDeployments: { worker: { status: 'active', deployment_id: '', version_ids: [] } },
  }), 'failure');
});

test('violation parser ignores headers and limits evidence', () => {
  assert.deepEqual(extractViolationEvidence(summaries.daily), [
    'D1 rows read — 17,570,384 / 28,470,606 / 5,000,000',
  ]);
  assert.equal(diagnosticSectionTitle('Telemetry', 'failure'), '[FAIL] Telemetry');
  assert.equal(diagnosticSectionTitle('Health', 'healthy'), '[OK] Health');
});

test('issue body puts runner and triage first, preserves the runner block, and uses stable anchors', () => {
  const runnerBlock = `${ACTIONS_RUNNER_HEALTH_START}\n### GitHub Actions runner health\n\n- **Overall:** healthy\n${ACTIONS_RUNNER_HEALTH_END}`;
  const body = buildIssueBody({
    generatedAt: '2026-07-26T15:00:00.000Z',
    targetSha: 'abc',
    mainSha: 'abc',
    runUrl: 'https://github.com/tarematsu/HP/actions/runs/1',
    trigger: 'schedule',
    outcomes,
    summaries,
    activeDeployments: deployments,
    recentMerges: [],
    actionsRunnerHealthBlock: runnerBlock,
  });
  assert.ok(body.indexOf('### GitHub Actions runner health') < body.indexOf('## Immediate triage'));
  assert.ok(body.indexOf('## Immediate triage') < body.indexOf('## Deployment and change context'));
  assert.ok(body.indexOf('## Deployment and change context') < body.indexOf('## Detailed diagnostics'));
  assert.match(body, /\*\*Cloudflare status:\*\* failure/);
  assert.match(body, /<a id="deployment-context"><\/a>/);
  assert.match(body, /<a id="diagnostic-telemetry"><\/a>/);
  assert.match(body, /<summary>\[FAIL\] Current-deployment telemetry policy<\/summary>/);
  assert.match(body, /<summary>\[OK\] Public application health endpoint snapshots<\/summary>/);
  assert.equal(extractActionsRunnerHealthBlock(body), runnerBlock);
});

test('large diagnostics are clipped per section without breaking Markdown containers', () => {
  const huge = 'x'.repeat(20_000);
  const body = buildIssueBody({
    generatedAt: '2026-07-26T15:00:00.000Z',
    targetSha: 'abc',
    mainSha: 'abc',
    runUrl: 'https://github.com/tarematsu/HP/actions/runs/1',
    trigger: 'schedule',
    outcomes,
    summaries: {
      publicHealth: huge,
      daily: huge,
      freeTier: huge,
      contract: huge,
      d1Insights: huge,
      observability: huge,
      telemetry: huge,
    },
    activeDeployments: deployments,
    recentMerges: [],
  });
  assert.ok(body.length <= 60_000);
  assert.equal((body.match(/<details>/g) || []).length, (body.match(/<\/details>/g) || []).length);
  assert.match(body, /<a id="diagnostic-telemetry"><\/a>/);
  assert.match(body, /…truncated…/);
  assert.match(body, /<\/details>$/);
});

test('runner section inserts before deployment context in the new issue layout', () => {
  const issue = '# Status\n\n## Immediate triage\nbody\n\n## Deployment and change context\ncontext';
  const updated = replaceActionsRunnerHealthSection(issue, '### GitHub Actions runner health\n\nhealthy');
  assert.ok(updated.indexOf(ACTIONS_RUNNER_HEALTH_START) < updated.indexOf('## Deployment and change context'));
});
