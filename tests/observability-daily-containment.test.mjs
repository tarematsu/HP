import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyDailyD1SnapshotPaces,
  classifyDailyRowsReadTrend,
  parseDailyRowsReadSnapshot,
  parseDailyRowsWrittenSnapshot,
  renderDailyD1SnapshotPace,
} from '../.github/scripts/observability-daily-trend.mjs';
import { buildObservabilityTriage } from '../.github/scripts/observability-issue-triage.mjs';
import { buildIssueBody } from '../.github/scripts/publish-cloudflare-observability-status.mjs';

function dailySummary(
  actual,
  projected = 406_087_050,
  date = '2026-07-27',
  writesActual = 36_859,
  writesProjected = 55_510,
  readStatus = 'VIOLATION (actual)',
) {
  return `## Cloudflare projected UTC daily budgets

- Date: \`${date}\`
- Observed UTC seconds: \`48,000\` / \`86,400\`

| Metric | Actual to now | Projected 24h | Limit | Headroom | Status |
|---|---:|---:|---:|---:|---|
| Worker and Pages requests | 10 | 20 | 100,000 | 99,980 | OK |
| D1 rows read | ${actual.toLocaleString('en-US')} | ${projected.toLocaleString('en-US')} | 5,000,000 | ${Math.max(0, 5_000_000 - projected).toLocaleString('en-US')} | ${readStatus} |
| D1 rows written | ${writesActual.toLocaleString('en-US')} | ${writesProjected.toLocaleString('en-US')} | 100,000 | ${Math.max(0, 100_000 - writesProjected).toLocaleString('en-US')} | OK |
| Queue billable operations | 10 | 20 | 10,000 | 9,980 | OK |
`;
}

function previousIssue({
  actual = 227_541_173,
  writesActual = 36_100,
  generatedAt = '2026-07-27T12:47:26.833Z',
  date = '2026-07-27',
} = {}) {
  return `<!-- cloudflare-observability-status -->
# Cloudflare Observability Status

- **Cloudflare status:** failure · **Generated:** ${generatedAt} · **Lookback:** 60 minutes

<a id="diagnostic-daily" name="diagnostic-daily"></a>
<details>
<summary>[FAIL] Account-wide projected UTC daily Worker, D1, and Queue budgets</summary>

${dailySummary(actual, 428_471_490, date, writesActual, 54_000)}
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

const healthyOutcomes = { ...outcomes, daily: 'success' };

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

test('daily D1 parsers accept read violations and healthy write rows', () => {
  assert.deepEqual(parseDailyRowsReadSnapshot(summaries.daily), {
    date: '2026-07-27',
    actual: 227_545_050,
    projected: 406_087_050,
    limit: 5_000_000,
    status: 'VIOLATION (actual)',
    violationSource: 'actual',
  });
  assert.deepEqual(parseDailyRowsWrittenSnapshot(summaries.daily), {
    date: '2026-07-27',
    actual: 36_859,
    projected: 55_510,
    limit: 100_000,
    status: 'OK',
    violationSource: '',
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
  assert.match(triage, /\| Recent D1 rows written pace \| \*\*OK\*\*/);
  assert.match(triage, /\| Projected daily usage \| \*\*CONTAINED\*\*/);
  assert.doesNotMatch(triage, /ACTION REQUIRED/);
});

test('snapshot pace renders D1 reads and writes with usage percentages', () => {
  const pace = renderDailyD1SnapshotPace({
    currentSummary: summaries.daily,
    previousIssueBody: previousIssue(),
    generatedAt,
  });
  assert.match(pace, /D1 snapshot delta pace/);
  assert.match(pace, /\| D1 rows read \| \+3,877 \| 41m \| 135,288\/day \| 5,000,000\/day \| 2\.7% \| within limit \|/);
  assert.match(pace, /\| D1 rows written \| \+759 \| 41m \| 26,486\/day \| 100,000\/day \| 26\.5% \| within limit \|/);
});

test('snapshot burn classification marks 80 percent as watch and 100 percent as failure', () => {
  const warning = classifyDailyD1SnapshotPaces({
    currentSummary: dailySummary(227_545_050, 406_087_050, '2026-07-27', 38_500, 58_000),
    previousIssueBody: previousIssue(),
    generatedAt,
  });
  assert.equal(warning.rowsWritten?.state, 'degraded');
  assert.equal(warning.rowsWritten?.recentProjected24h, 83_748);

  const failure = classifyDailyD1SnapshotPaces({
    currentSummary: dailySummary(227_545_050, 406_087_050, '2026-07-27', 39_100, 60_000),
    previousIssueBody: previousIssue(),
    generatedAt,
  });
  assert.equal(failure.rowsWritten?.state, 'failure');
  assert.equal(failure.rowsWritten?.recentProjected24h, 104_685);
});

test('recent write burst is active while a historical read breach remains contained', () => {
  const burstSummaries = {
    ...summaries,
    daily: dailySummary(227_545_050, 406_087_050, '2026-07-27', 39_100, 60_000),
  };
  const triage = buildObservabilityTriage({
    outcomes,
    summaries: burstSummaries,
    activeDeployments: deployments,
    previousIssueBody: previousIssue(),
    generatedAt,
  });
  assert.match(triage, /ACTION REQUIRED — 1 active signal; 1 contained historical signal/);
  assert.match(triage, /Recent D1 write pace/);
  assert.match(triage, /recent pace 104,685\/day, 104\.7% of 100,000\/day limit/);
  assert.match(triage, /Historical daily D1 breach/);
  assert.match(triage, /\| Recent D1 rows written pace \| \*\*FAIL\*\*/);
});

test('recent write burst fails overall status before the UTC projection catches up', () => {
  const burstSummaries = {
    ...summaries,
    daily: dailySummary(1_000, 2_000, '2026-07-27', 39_100, 60_000, 'OK'),
  };
  const body = buildIssueBody({
    generatedAt,
    targetSha: 'abc',
    mainSha: 'abc',
    runUrl: 'https://github.com/tarematsu/HP/actions/runs/1',
    trigger: 'workflow_run',
    outcomes: healthyOutcomes,
    summaries: burstSummaries,
    activeDeployments: deployments,
    previousIssueBody: previousIssue(),
  });
  assert.match(body, /\*\*Cloudflare status:\*\* failure/);
  assert.match(body, /ACTION REQUIRED — 1 active signal/);
  assert.match(body, /Recent D1 write pace/);
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

  const shortPaces = classifyDailyD1SnapshotPaces({
    currentSummary: summaries.daily,
    previousIssueBody: previousIssue({ generatedAt: '2026-07-27T13:13:42.647Z' }),
    generatedAt,
  });
  assert.equal(shortPaces.rowsRead, null);
  assert.equal(shortPaces.rowsWritten, null);
});

test('contained historical daily breach publishes a successful Cloudflare status', () => {
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
  assert.match(body, /### D1 snapshot delta pace/);
  assert.match(body, /D1 rows written \| \+759 \| 41m \| 26,486\/day \| 100,000\/day \| 26\.5%/);
  assert.match(body, /\*\*Cloudflare status:\*\* success/);
});

test('another daily-budget violation remains active beside a contained D1 read breach', () => {
  const queueViolation = summaries.daily.replace(
    '| Queue billable operations | 10 | 20 | 10,000 | 9,980 | OK |',
    '| Queue billable operations | 11,000 | 12,000 | 10,000 | 0 | VIOLATION (actual) |',
  );
  const body = buildIssueBody({
    generatedAt,
    targetSha: 'abc',
    mainSha: 'abc',
    runUrl: 'https://github.com/tarematsu/HP/actions/runs/1',
    trigger: 'workflow_run',
    outcomes,
    summaries: { ...summaries, daily: queueViolation },
    activeDeployments: deployments,
    previousIssueBody: previousIssue(),
  });
  assert.match(body, /\*\*Cloudflare status:\*\* failure/);
  assert.match(body, /ACTION REQUIRED — 1 active signal/);
  assert.match(body, /Queue billable operations/);
  assert.doesNotMatch(body, /CONTAINED — 1 historical signal remains/);
});
