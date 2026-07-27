import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyDailyRowsReadTrend,
  parseDailyRowsReadSnapshot,
} from '../.github/scripts/observability-daily-trend.mjs';
import { buildObservabilityTriage } from '../.github/scripts/observability-issue-triage.mjs';
import { buildIssueBody } from '../.github/scripts/publish-cloudflare-observability-status.mjs';

function dailySummary(actual, projected = 406_087_050, date = '2026-07-27') {
  return `## Cloudflare projected UTC daily budgets

- Date: \`${date}\`
- Observed UTC seconds: \`48,000\` / \`86,400\`

| Metric | Actual to now | Projected 24h | Limit | Headroom | Status |
|---|---:|---:|---:|---:|---|
| Worker and Pages requests | 10 | 20 | 100,000 | 99,980 | OK |
| D1 rows read | ${actual.toLocaleString('en-US')} | ${projected.toLocaleString('en-US')} | 5,000,000 | 0 | VIOLATION (actual) |
| D1 rows written | 10 | 20 | 100,000 | 99,980 | OK |
| Queue billable operations | 10 | 20 | 10,000 | 9,980 | OK |
`;
}

function previousIssue({ actual = 227_541_173, generatedAt = '2026-07-27T12:47:26.833Z', date = '2026-07-27' } = {}) {
  return `<!-- cloudflare-observability-status -->
# Cloudflare Observability Status

- **Cloudflare status:** failure · **Generated:** ${generatedAt} · **Lookback:** 60 minutes

<a id="diagnostic-daily" name="diagnostic-daily"></a>
<details>
<summary>[FAIL] Account-wide projected UTC daily Worker, D1, and Queue budgets</summary>

${dailySummary(actual, 428_471_490, date)}
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

const summaries = {
  publicHealth: '| Endpoint | Result | HTTP |\n|---|---|---|\n| Unified health | success | 200 OK |',
  daily: dailySummary(227_545_050),
  freeTier: 'No failure reported.',
  contract: 'No failure reported.',
  d1Insights: 'No failure reported.',
  observability: 'No failure reported.',
  telemetry: 'No failure reported.',
};

const deployments = {
  'homepanel-cloud': { status: 'active', deployment_id: 'd1', version_ids: ['v1'] },
  'sh-runtime-orchestrator': { status: 'active', deployment_id: 'd2', version_ids: ['v2'] },
};

const generatedAt = '2026-07-27T13:28:42.647Z';

test('daily rows-read parser accepts actual-source violation rows', () => {
  assert.deepEqual(parseDailyRowsReadSnapshot(summaries.daily), {
    date: '2026-07-27',
    actual: 227_545_050,
    projected: 406_087_050,
    limit: 5_000_000,
    status: 'VIOLATION (actual)',
    violationSource: 'actual',
  });
});

test('historical daily breach is contained when the recent delta pace is within budget', () => {
  const previousIssueBody = previousIssue();
  const trend = classifyDailyRowsReadTrend({
    currentSummary: summaries.daily,
    previousIssueBody,
    generatedAt,
  });
  assert.equal(trend?.contained, true);
  assert.equal(trend?.delta, 3_877);
  assert.equal(trend?.recentProjected24h, 135_288);

  const triage = buildObservabilityTriage({
    outcomes,
    summaries,
    activeDeployments: deployments,
    previousIssueBody,
    generatedAt,
    runUrl: 'https://github.com/tarematsu/HP/actions/runs/1',
  });
  assert.match(triage, /CONTAINED — 1 historical signal remains until the UTC counter resets/);
  assert.match(triage, /Historical daily D1 breach/);
  assert.match(triage, /recent pace 135,288\/day vs 5,000,000\/day limit/);
  assert.match(triage, /\| Projected daily usage \| \*\*CONTAINED\*\*/);
  assert.doesNotMatch(triage, /ACTION REQUIRED/);
});

test('current runaway pace remains an active daily-usage incident', () => {
  const previousIssueBody = previousIssue({
    actual: 227_000_000,
    generatedAt: '2026-07-27T12:58:42.647Z',
  });
  const trend = classifyDailyRowsReadTrend({
    currentSummary: summaries.daily,
    previousIssueBody,
    generatedAt,
  });
  assert.equal(trend?.contained, false);
  assert.ok(trend.recentProjected24h > 5_000_000);

  const triage = buildObservabilityTriage({
    outcomes,
    summaries,
    activeDeployments: deployments,
    previousIssueBody,
    generatedAt,
  });
  assert.match(triage, /ACTION REQUIRED — 1 active signal/);
  assert.match(triage, /Projected daily usage/);
  assert.doesNotMatch(triage, /Historical daily D1 breach/);
});

test('trend classification fails closed across UTC dates or short samples', () => {
  assert.equal(classifyDailyRowsReadTrend({
    currentSummary: summaries.daily,
    previousIssueBody: previousIssue({ date: '2026-07-26' }),
    generatedAt,
  }), null);
  assert.equal(classifyDailyRowsReadTrend({
    currentSummary: summaries.daily,
    previousIssueBody: previousIssue({ generatedAt: '2026-07-27T13:23:42.647Z' }),
    generatedAt,
  }), null);
});

test('issue builder passes the previous snapshot into immediate triage', () => {
  const body = buildIssueBody({
    generatedAt,
    targetSha: 'abc',
    mainSha: 'abc',
    runUrl: 'https://github.com/tarematsu/HP/actions/runs/1',
    trigger: 'workflow_run',
    outcomes,
    summaries,
    activeDeployments: deployments,
    previousIssueBody: previousIssue(),
  });
  assert.match(body, /CONTAINED — 1 historical signal remains until the UTC counter resets/);
  assert.match(body, /\*\*Cloudflare status:\*\* failure/);
});
