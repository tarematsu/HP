#!/usr/bin/env node

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import {
  MAX_ISSUE_BODY_CHARS,
  clipText,
  createGitHubRequest,
  normalizeOutcome,
  overallOutcome,
  publishCommitStatuses,
  readOptionalText,
  renderOutcomeRows,
  renderSection,
  requiredEnv,
  statusState,
  upsertStatusIssue,
} from './observability-status-publisher.mjs';

export { normalizeOutcome, overallOutcome, statusState };

export const STATUS_ISSUE_TITLE = 'HomePanel Observability Status';
export const STATUS_MARKER = '<!-- homepanel-observability-status -->';

const STATUS_CONTEXTS = {
  policy: 'observability/policy-self-test',
  daily: 'observability/daily-usage-budget',
  d1Insights: 'observability/d1-query-insights',
  query: 'observability/cloudflare-query',
  telemetry: 'observability/telemetry-policy',
};

export function buildIssueBody({
  generatedAt,
  targetSha,
  runUrl,
  trigger,
  lookbackMinutes,
  outcomes,
  summaries = {},
}) {
  const overall = overallOutcome(outcomes);
  const body = `${STATUS_MARKER}
# HomePanel Observability Status

This issue is maintained automatically by the HomePanel Cloudflare Observability workflow.

- **Overall:** ${overall}
- **Generated:** ${generatedAt}
- **Trigger:** ${trigger}
- **Commit:** \`${targetSha}\`
- **Workflow run:** ${runUrl}
- **Telemetry and D1 insights lookback:** ${lookbackMinutes} minutes

| Gate | Outcome |
|---|---|
${renderOutcomeRows(outcomes)}
${renderSection('Projected UTC daily Worker, D1, and Queue budgets', summaries.daily)}
${renderSection('Top D1 queries by rows read', summaries.d1Insights)}
${renderSection('Cloudflare metrics and persisted errors', summaries.observability)}
${renderSection('Current-version CPU and error policy', summaries.telemetry)}
`;
  return clipText(body, MAX_ISSUE_BODY_CHARS);
}

export async function publishFromEnvironment() {
  const targetSha = requiredEnv('OBSERVABILITY_TARGET_SHA');
  const runUrl = requiredEnv('OBSERVABILITY_RUN_URL');
  const request = createGitHubRequest('homepanel-observability-status');
  const outcomes = {
    policy: process.env.POLICY_OUTCOME,
    daily: process.env.DAILY_BUDGET_OUTCOME,
    d1Insights: process.env.D1_INSIGHTS_OUTCOME,
    query: process.env.OBSERVABILITY_QUERY_OUTCOME,
    telemetry: process.env.TELEMETRY_POLICY_OUTCOME,
  };
  const [daily, d1Insights, observability, telemetry] = await Promise.all([
    readOptionalText('daily-usage/summary.md'),
    readOptionalText('d1-insights/summary.md'),
    readOptionalText('observability-summary.md'),
    readOptionalText('telemetry-summary.md'),
  ]);
  const body = buildIssueBody({
    generatedAt: new Date().toISOString(),
    targetSha,
    runUrl,
    trigger: process.env.OBSERVABILITY_TRIGGER || 'unknown',
    lookbackMinutes: process.env.LOOKBACK_MINUTES || '60',
    outcomes,
    summaries: { daily, d1Insights, observability, telemetry },
  });
  await publishCommitStatuses({
    request,
    targetSha,
    runUrl,
    outcomes,
    contexts: STATUS_CONTEXTS,
    overallDescription: 'HomePanel observability',
  });
  const issue = await upsertStatusIssue({
    request,
    title: STATUS_ISSUE_TITLE,
    marker: STATUS_MARKER,
    body,
  });
  console.log(`Published HomePanel observability status to issue #${issue.number}`);
}

function selfTest() {
  assert.equal(statusState('success'), 'success');
  assert.equal(statusState('skipped'), 'failure');
  assert.equal(statusState('unknown'), 'failure');
  assert.equal(statusState('failure'), 'failure');
  assert.equal(overallOutcome({ a: 'success', b: 'success' }), 'success');
  assert.equal(overallOutcome({ a: 'success', b: 'skipped' }), 'failure');
  assert.equal(overallOutcome({ a: 'success', b: 'unknown' }), 'failure');
  const body = buildIssueBody({
    generatedAt: '2026-07-23T00:00:00.000Z',
    targetSha: 'abc123',
    runUrl: 'https://github.com/tarematsu/HP/actions/runs/1',
    trigger: 'workflow_run',
    lookbackMinutes: '60',
    outcomes: {
      policy: 'success',
      daily: 'failure',
      d1Insights: 'success',
      query: 'skipped',
      telemetry: 'success',
    },
    summaries: {
      daily: '## Daily\n\n| Metric | Value |\n|---|---:|\n| Queue | 1 |',
      d1Insights: '## D1 query insights\n\n| SQL fingerprint | Total reads |\n|---|---:|\n| `abc` | 12 |',
      telemetry: 'Authorization: Bearer secret-value',
    },
  });
  assert.match(body, /HomePanel Observability Status/);
  assert.match(body, /\*\*Overall:\*\* failure/);
  assert.match(body, /\| d1Insights \| success \|/);
  assert.match(body, /Top D1 queries by rows read/);
  assert.match(body, /abc123/);
  assert.doesNotMatch(body, /secret-value/);
  assert.match(body, /Bearer \[redacted\]/);
  console.log('HomePanel observability status publisher self-test passed');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishFromEnvironment().catch((error) => {
    console.error(`::error title=Publish HomePanel observability status::${String(error?.message || error).replaceAll('\n', ' ').slice(0, 1000)}`);
    process.exitCode = 1;
  });
}
