import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildObservabilityTriage,
  observabilityIssueOverall,
} from '../.github/scripts/observability-issue-triage.mjs';

function dailySummary({
  reads,
  writes,
  queueStatus = 'OK',
  queueActual = 510,
} = {}) {
  return `## Cloudflare projected UTC daily budgets

- Date: \`2026-07-30\`

| Metric | Actual to now | Projected 24h | Limit | Headroom | Status |
|---|---:|---:|---:|---:|---|
| Worker and Pages requests | 1,242 | 2,645 | 100,000 | 97,355 | OK |
| D1 rows read | ${reads.toLocaleString('en-US')} | 180,246,393 | 5,000,000 | 0 | VIOLATION (actual) |
| D1 rows written | ${writes.toLocaleString('en-US')} | 357,097 | 100,000 | 0 | VIOLATION (actual) |
| Queue billable operations | ${queueActual.toLocaleString('en-US')} | 1,086 | 10,000 | 8,914 | ${queueStatus} |
`;
}

function previousIssueBody() {
  return `<!-- cloudflare-observability-status -->
# Cloudflare Observability Status

- **Cloudflare status:** failure · **Generated:** 2026-07-30T10:05:13.697Z · **Lookback:** 60 minutes

<a id="diagnostic-daily" name="diagnostic-daily"></a>
<details>
<summary>[FAIL] Account-wide projected UTC daily Worker, D1, and Queue budgets</summary>

${dailySummary({ reads: 84_657_777, writes: 166_098 })}
</details>

<a id="diagnostic-free-tier" name="diagnostic-free-tier"></a>`;
}

const outcomes = {
  daily: 'failure',
  freeTier: 'success',
  contract: 'success',
  d1Insights: 'success',
  query: 'success',
  telemetry: 'success',
};

const deployments = {
  'homepanel-cloud': { status: 'active', deployment_id: 'd1', version_ids: ['v1'] },
  'sh-runtime-orchestrator': { status: 'active', deployment_id: 'd2', version_ids: ['v2'] },
};

const summaries = {
  publicHealth: '| Endpoint | Result | HTTP |\n|---|---|---|\n| Unified health | success | 200 OK |',
  daily: dailySummary({ reads: 84_663_650, writes: 167_732 }),
  freeTier: 'No failure reported.',
  contract: 'No failure reported.',
  d1Insights: 'No failure reported.',
  observability: 'No failure reported.',
  telemetry: 'No failure reported.',
};

const generatedAt = '2026-07-30T11:18:13.697Z';

test('contained read and write actual breaches do not keep observability unhealthy', () => {
  const triage = buildObservabilityTriage({
    outcomes,
    summaries,
    activeDeployments: deployments,
    previousIssueBody: previousIssueBody(),
    generatedAt,
  });

  assert.match(triage, /CONTAINED — 1 historical signal remains until the UTC counter resets/);
  assert.match(triage, /D1 rows read remain above the UTC-day limit/);
  assert.match(triage, /D1 rows written remain above the UTC-day limit/);
  assert.match(triage, /\| Projected daily usage \| \*\*CONTAINED\*\*/);
  assert.doesNotMatch(triage, /ACTION REQUIRED/);
  assert.equal(observabilityIssueOverall({
    outcomes,
    summaries,
    activeDeployments: deployments,
    previousIssueBody: previousIssueBody(),
    generatedAt,
  }), 'success');
});

test('a non-D1 daily violation still remains active', () => {
  const queueSummaries = {
    ...summaries,
    daily: dailySummary({
      reads: 84_663_650,
      writes: 167_732,
      queueActual: 11_000,
      queueStatus: 'VIOLATION (actual)',
    }),
  };
  const triage = buildObservabilityTriage({
    outcomes,
    summaries: queueSummaries,
    activeDeployments: deployments,
    previousIssueBody: previousIssueBody(),
    generatedAt,
  });
  assert.match(triage, /ACTION REQUIRED — 1 active signal/);
  assert.match(triage, /Queue billable operations/);
  assert.equal(observabilityIssueOverall({
    outcomes,
    summaries: queueSummaries,
    activeDeployments: deployments,
    previousIssueBody: previousIssueBody(),
    generatedAt,
  }), 'failure');
});
