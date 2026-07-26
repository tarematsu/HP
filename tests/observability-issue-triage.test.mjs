import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildObservabilityTriage,
  diagnosticSectionTitle,
  extractViolationEvidence,
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
  assert.match(triage, /workflow run/);
});

test('public health failure outranks budget findings', () => {
  const triage = buildObservabilityTriage({
    outcomes: { ...outcomes, telemetry: 'success' },
    summaries: {
      ...summaries,
      publicHealth: '| Endpoint | Result | HTTP |\n|---|---|---|\n| Unified health | failure | HTTP 503 |',
    },
    activeDeployments: deployments,
  });
  assert.match(triage, /Highest priority: \*\*Public availability\*\*/);
  assert.match(triage, /\*\*P0\*\*/);
  assert.equal(publicHealthSignal(summaries.publicHealth).state, 'healthy');
});

test('violation parser ignores headers and limits evidence', () => {
  assert.deepEqual(extractViolationEvidence(summaries.daily), [
    'D1 rows read — 17,570,384 / 28,470,606 / 5,000,000',
  ]);
  assert.equal(diagnosticSectionTitle('Telemetry', 'failure'), '[FAIL] Telemetry');
  assert.equal(diagnosticSectionTitle('Health', 'healthy'), '[OK] Health');
});

test('issue body puts triage first, preserves runner block, and collapses context', () => {
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
  assert.ok(body.indexOf('## Immediate triage') < body.indexOf('### GitHub Actions runner health'));
  assert.ok(body.indexOf('### GitHub Actions runner health') < body.indexOf('## Deployment and change context'));
  assert.ok(body.indexOf('## Deployment and change context') < body.indexOf('## Detailed diagnostics'));
  assert.match(body, /<summary>\[FAIL\] Current-deployment telemetry policy<\/summary>/);
  assert.match(body, /<summary>\[OK\] Public application health endpoint snapshots<\/summary>/);
  assert.equal(extractActionsRunnerHealthBlock(body), runnerBlock);
});

test('runner section inserts before deployment context in the new issue layout', () => {
  const issue = '# Status\n\n## Immediate triage\nbody\n\n## Deployment and change context\ncontext';
  const updated = replaceActionsRunnerHealthSection(issue, '### GitHub Actions runner health\n\nhealthy');
  assert.ok(updated.indexOf(ACTIONS_RUNNER_HEALTH_START) < updated.indexOf('## Deployment and change context'));
});
