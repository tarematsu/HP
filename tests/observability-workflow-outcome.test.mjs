import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publishSemanticOverallStatus,
  resolveObservabilityWorkflowOutcome,
} from '../.github/scripts/observability-workflow-outcome.mjs';

const generatedAt = '2026-07-28T09:24:34.146Z';
const outcomes = {
  daily: 'failure',
  freeTier: 'success',
  contract: 'success',
  d1Insights: 'success',
  query: 'success',
  telemetry: 'success',
};
const deployments = {
  'sh-runtime-orchestrator': {
    status: 'active',
    deployment_id: 'runtime-deployment',
    version_ids: ['runtime-version'],
  },
  'homepanel-cloud': {
    status: 'active',
    deployment_id: 'cloud-deployment',
    version_ids: ['cloud-version'],
  },
};

function dailySummary({ queueStatus = 'OK' } = {}) {
  return `## Cloudflare projected UTC daily budgets

- Date: \`2026-07-28\`
- Observed UTC seconds: \`33,874\` / \`86,400\`

| Metric | Actual to now | Projected 24h | Limit | Headroom | Status |
|---|---:|---:|---:|---:|---|
| Worker and Pages requests | 10 | 25 | 100,000 | 99,975 | OK |
| D1 rows read | 34,108,648 | 86,989,500 | 5,000,000 | 0 | VIOLATION (actual) |
| D1 rows written | 25,000 | 63,768 | 100,000 | 36,232 | OK |
| Queue billable operations | 10 | 25 | 10,000 | 9,975 | ${queueStatus} |
`;
}

const previousIssueBody = `<!-- cloudflare-observability-status -->
# Cloudflare Observability Status

- **Cloudflare status:** failure · **Generated:** 2026-07-28T08:50:34.146Z · **Lookback:** 60 minutes

<a id="diagnostic-daily" name="diagnostic-daily"></a>
<details>
<summary>[FAIL] Account-wide projected UTC daily Worker, D1, and Queue budgets</summary>

${dailySummary().replace('34,108,648', '34,105,626')}
</details>`;

const summaries = {
  publicHealth: '| Endpoint | Result | HTTP |\n|---|---|---|\n| Unified health | success | 200 OK |',
  daily: dailySummary(),
  freeTier: 'No failure reported.',
  contract: 'No failure reported.',
  d1Insights: 'No failure reported.',
  observability: 'No failure reported.',
  telemetry: 'No failure reported.',
};

test('contained historical D1 read breach keeps the current-main workflow successful', () => {
  const decision = resolveObservabilityWorkflowOutcome({
    targetSha: 'main-sha',
    mainSha: 'main-sha',
    outcomes,
    summaries,
    activeDeployments: deployments,
    previousIssueBody,
    generatedAt,
  });

  assert.deepEqual(decision, {
    currentMainTarget: true,
    overall: 'success',
  });
});

test('another daily violation remains an active current-main workflow failure', () => {
  const decision = resolveObservabilityWorkflowOutcome({
    targetSha: 'main-sha',
    mainSha: 'main-sha',
    outcomes,
    summaries: {
      ...summaries,
      daily: dailySummary({ queueStatus: 'VIOLATION (actual)' }),
    },
    activeDeployments: deployments,
    previousIssueBody,
    generatedAt,
  });

  assert.equal(decision.currentMainTarget, true);
  assert.equal(decision.overall, 'failure');
});

test('stale workflow runs are identified without changing semantic diagnosis', () => {
  const decision = resolveObservabilityWorkflowOutcome({
    targetSha: 'old-sha',
    mainSha: 'main-sha',
    outcomes,
    summaries,
    activeDeployments: deployments,
    previousIssueBody,
    generatedAt,
  });

  assert.equal(decision.currentMainTarget, false);
  assert.equal(decision.overall, 'success');
});

test('semantic status publisher overwrites only the overall commit context', async () => {
  const calls = [];
  await publishSemanticOverallStatus({
    request: async (...args) => {
      calls.push(args);
      return {};
    },
    targetSha: 'main/sha',
    runUrl: 'https://github.com/tarematsu/HP/actions/runs/1',
    overall: 'success',
  });

  assert.deepEqual(calls, [[
    'POST',
    '/statuses/main%2Fsha',
    {
      state: 'success',
      context: 'observability/overall',
      description: 'Unified Cloudflare observability: success',
      target_url: 'https://github.com/tarematsu/HP/actions/runs/1',
    },
  ]]);
  await assert.rejects(
    publishSemanticOverallStatus({
      request: async () => ({}),
      targetSha: 'main-sha',
      runUrl: 'https://github.com/tarematsu/HP/actions/runs/1',
      overall: 'unknown',
    }),
    /Invalid semantic observability outcome/,
  );
});
