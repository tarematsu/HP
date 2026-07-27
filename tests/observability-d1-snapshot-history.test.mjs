import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyDailyD1SnapshotPaces,
  classifyDailyRowsReadTrend,
  parseD1SnapshotHistory,
  renderD1SnapshotHistory,
  renderDailyD1SnapshotPace,
} from '../.github/scripts/observability-daily-trend.mjs';
import { buildObservabilityTriage } from '../.github/scripts/observability-issue-triage.mjs';
import { buildIssueBody } from '../.github/scripts/publish-cloudflare-observability-status.mjs';

function dailySummary({
  date = '2026-07-27',
  rowsRead,
  rowsWritten,
  readStatus = 'VIOLATION (actual)',
} = {}) {
  return `## Cloudflare projected UTC daily budgets

- Date: \`${date}\`
- Observed UTC seconds: \`48,000\` / \`86,400\`

| Metric | Actual to now | Projected 24h | Limit | Headroom | Status |
|---|---:|---:|---:|---:|---|
| Worker and Pages requests | 10 | 20 | 100,000 | 99,980 | OK |
| D1 rows read | ${rowsRead.toLocaleString('en-US')} | ${rowsRead.toLocaleString('en-US')} | 5,000,000 | 0 | ${readStatus} |
| D1 rows written | ${rowsWritten.toLocaleString('en-US')} | ${rowsWritten.toLocaleString('en-US')} | 100,000 | ${Math.max(0, 100_000 - rowsWritten).toLocaleString('en-US')} | OK |
| Queue billable operations | 10 | 20 | 10,000 | 9,980 | OK |
`;
}

function historyBlock(snapshots) {
  return `<!-- d1-snapshot-history:start
${JSON.stringify({ version: 1, snapshots })}
d1-snapshot-history:end -->`;
}

function previousIssue({
  generatedAt,
  rowsRead,
  rowsWritten,
  history = '',
  date = '2026-07-27',
} = {}) {
  return `<!-- cloudflare-observability-status -->
# Cloudflare Observability Status

- **Cloudflare status:** failure · **Generated:** ${generatedAt} · **Lookback:** 60 minutes

${history}

<a id="diagnostic-daily" name="diagnostic-daily"></a>
<details>
<summary>[FAIL] Account-wide projected UTC daily Worker, D1, and Queue budgets</summary>

${dailySummary({ date, rowsRead, rowsWritten })}
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

const activeDeployments = {
  'sh-runtime-orchestrator': {
    status: 'active',
    deployment_id: 'runtime-deployment',
    version_ids: ['runtime-version'],
  },
};

function summaries(daily) {
  return {
    publicHealth: '| Endpoint | Result | HTTP |\n|---|---|---|\n| Unified health | success | 200 OK |',
    daily,
    freeTier: 'No failure reported.',
    contract: 'No failure reported.',
    d1Insights: 'No failure reported.',
    observability: 'No failure reported.',
    telemetry: 'No failure reported.',
  };
}

test('containment fails closed when only a 17-minute comparison exists', () => {
  const generatedAt = '2026-07-27T13:30:00.000Z';
  const currentSummary = dailySummary({ rowsRead: 10_004_000, rowsWritten: 42_000 });
  const previousIssueBody = previousIssue({
    generatedAt: '2026-07-27T13:13:00.000Z',
    rowsRead: 10_002_500,
    rowsWritten: 41_600,
  });

  assert.equal(classifyDailyRowsReadTrend({
    currentSummary,
    previousIssueBody,
    generatedAt,
  }), null);

  const paces = classifyDailyD1SnapshotPaces({
    currentSummary,
    previousIssueBody,
    generatedAt,
  });
  assert.equal(paces.rowsRead, null);
  assert.equal(paces.rowsWritten, null);

  const display = renderDailyD1SnapshotPace({
    currentSummary,
    previousIssueBody,
    generatedAt,
  });
  assert.match(display, /\| D1 rows read \| \+1,500 \| 17m \| 127,059\/day/);

  const triage = buildObservabilityTriage({
    outcomes,
    summaries: summaries(currentSummary),
    activeDeployments,
    previousIssueBody,
    generatedAt,
  });
  assert.match(triage, /ACTION REQUIRED — 1 active signal/);
  assert.match(triage, /Projected daily usage/);
  assert.doesNotMatch(triage, /Historical daily D1 breach/);
  assert.match(triage, /Recent D1 rows read pace \| \*\*UNKNOWN\*\*/);
});

test('alert and containment select the newest history snapshot at least 20 minutes old', () => {
  const generatedAt = '2026-07-27T13:30:00.000Z';
  const currentSummary = dailySummary({ rowsRead: 10_004_000, rowsWritten: 42_000 });
  const history = historyBlock([
    {
      generatedAt: '2026-07-27T12:50:00.000Z',
      date: '2026-07-27',
      rowsRead: 10_000_000,
      rowsWritten: 41_000,
    },
  ]);
  const previousIssueBody = previousIssue({
    generatedAt: '2026-07-27T13:13:00.000Z',
    rowsRead: 10_002_500,
    rowsWritten: 41_600,
    history,
  });

  const trend = classifyDailyRowsReadTrend({
    currentSummary,
    previousIssueBody,
    generatedAt,
  });
  assert.equal(trend?.contained, true);
  assert.equal(trend?.elapsedSeconds, 40 * 60);
  assert.equal(trend?.delta, 4_000);
  assert.equal(trend?.recentProjected24h, 144_000);

  const paces = classifyDailyD1SnapshotPaces({
    currentSummary,
    previousIssueBody,
    generatedAt,
  });
  assert.equal(paces.rowsRead?.elapsedSeconds, 40 * 60);
  assert.equal(paces.rowsWritten?.elapsedSeconds, 40 * 60);

  const display = renderDailyD1SnapshotPace({
    currentSummary,
    previousIssueBody,
    generatedAt,
  });
  assert.match(display, /\| D1 rows read \| \+1,500 \| 17m \| 127,059\/day/);
  assert.match(display, /Alert and containment classification use the newest comparable snapshot at least 20 minutes old/);

  const triage = buildObservabilityTriage({
    outcomes,
    summaries: summaries(currentSummary),
    activeDeployments,
    previousIssueBody,
    generatedAt,
  });
  assert.match(triage, /CONTAINED — 1 historical signal remains/);
  assert.match(triage, /recent pace 144,000\/day vs 5,000,000\/day limit/);
  assert.match(triage, /Recent D1 rows read pace \| \*\*OK\*\*/);
});

test('history is persisted in the issue body and bounded to eight snapshots', () => {
  const snapshots = Array.from({ length: 8 }, (_, index) => ({
    generatedAt: new Date(Date.parse('2026-07-27T11:00:00.000Z') + index * 10 * 60_000).toISOString(),
    date: '2026-07-27',
    rowsRead: 9_990_000 + index * 1_000,
    rowsWritten: 40_000 + index * 100,
  }));
  const previousIssueBody = previousIssue({
    generatedAt: snapshots.at(-1).generatedAt,
    rowsRead: snapshots.at(-1).rowsRead,
    rowsWritten: snapshots.at(-1).rowsWritten,
    history: historyBlock(snapshots),
  });
  const generatedAt = '2026-07-27T12:20:00.000Z';
  const currentSummary = dailySummary({ rowsRead: 10_000_000, rowsWritten: 41_000 });

  const rendered = renderD1SnapshotHistory({ currentSummary, previousIssueBody, generatedAt });
  const parsed = parseD1SnapshotHistory(rendered);
  assert.equal(parsed.length, 8);
  assert.equal(parsed[0].generatedAt, '2026-07-27T11:10:00.000Z');
  assert.equal(parsed.at(-1).generatedAt, generatedAt);

  const body = buildIssueBody({
    generatedAt,
    targetSha: 'abc',
    mainSha: 'abc',
    runUrl: 'https://github.com/tarematsu/HP/actions/runs/1',
    trigger: 'workflow_run',
    outcomes,
    summaries: summaries(currentSummary),
    activeDeployments,
    previousIssueBody,
  });
  assert.match(body, /<!-- d1-snapshot-history:start/);
  const bodyHistory = parseD1SnapshotHistory(body);
  assert.equal(bodyHistory.length, 8);
  assert.equal(bodyHistory.at(-1).generatedAt, generatedAt);
});
