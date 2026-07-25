import assert from 'node:assert/strict';
import test from 'node:test';

import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';

test('HomePanel observability workflow keeps the production contract', () => {
  const workflow = readSource('.github/workflows/hp-observability.yml');
  const unifiedCi = readSource('.github/workflows/homepanel-unified-ci.yml');

  expectAll(workflow, [
    'workflows: ["Deploy unified homepanel-cloud Worker"]',
    'cron: "47 2 * * *"',
    'issues: write',
    'statuses: write',
    'D1_CONFIG_GLOBS: hp/cloud/wrangler.jsonc',
    'D1_QUERY_OUTPUT_DIR: d1-insights',
    'D1_QUERY_LOOKBACK_MINUTES:',
    'D1_QUERY_LIMIT: "20"',
    'DAILY_REQUEST_BUDGET: "3000"',
    'DAILY_REQUEST_RESERVE: "0"',
    'DAILY_D1_READ_BUDGET: "50000"',
    'DAILY_D1_WRITE_BUDGET: "3000"',
    'DAILY_QUEUE_BUDGET: "1000"',
    'Enforce projected UTC daily Worker, D1, and Queue budgets',
    'Collect top D1 queries by rows read',
    'query-cloudflare-d1-costs.py',
    'D1_INSIGHTS_OUTCOME',
    'id: observability-query',
    'telemetry-summary.md',
    'Publish persistent observability status',
    'publish-homepanel-observability-status.mjs',
    'steps.publish-status.outcome',
    'if: always()',
    'set -o pipefail',
    'retention-days: 1',
  ]);
  expectAll(unifiedCi, [
    'python3 .github/scripts/audit-cloudflare-daily-usage.py --self-test',
    'python3 .github/scripts/audit-cloudflare-telemetry.py --self-test',
    'python3 .github/scripts/query-cloudflare-d1-costs.py --self-test',
    'tests/cloudflare-account-context.test.mjs',
    'tests/homepanel-*.test.mjs',
    'tests/observability-status-publisher.test.mjs',
  ]);
  expectNone(workflow, [
    'cron: "23 * * * *"',
    'actions: read',
    'Determine whether upstream run deployed the Worker',
    'steps.deployment.outputs',
    'Report deferred post-deployment runtime audit',
    'Start deep audit window',
    'AUDIT_FROM=',
    '\n  pull_request:',
    'R2_BUCKET',
    '--self-test',
    'node --test',
    'policy-self-test',
    'tests/homepanel-*.test.mjs',
    'tests/homepanel-runtime-contract.test.mjs',
    'tests/homepanel-video-contract.test.mjs',
    'tests/homepanel-migrations-contract.test.mjs',
    'query-cloudflare-d1-insights.mjs',
    'Install pinned Wrangler for D1 insights',
    'steps.install-wrangler',
    'npm ci --prefix hp/cloud',
  ]);
  assert.doesNotMatch(workflow, /^\s+POLICY_OUTCOME:/m);
  expectNone(unifiedCi, [
    'query-cloudflare-d1-insights.mjs',
    'wrangler d1 insights --help',
    "grep -q -- '--time-period'",
    "grep -q -- '--sort-by'",
    "grep -q -- '--json'",
  ]);
  assert.doesNotMatch(workflow, /^\s{6}CLOUDFLARE_API_TOKEN:/m);
  assert.equal(workflow.match(/cron: "/g)?.length, 1);
  assert.ok(workflow.includes('\n  push:'));
  assert.ok(workflow.includes('branches: [main]'));
});

test('HomePanel observability publisher and usage documentation retain product behavior', () => {
  const publisher = readSource('.github/scripts/publish-homepanel-observability-status.mjs');
  const usageDocumentation = readSource('hp/cloud/D1_USAGE_MEASUREMENT.md');

  expectAll(publisher, [
    'HomePanel Observability Status',
    '<!-- homepanel-observability-status -->',
    './observability-status-publisher.mjs',
    'observability/d1-query-insights',
    'Top D1 queries by rows read',
    "readOptionalText('daily-usage/summary.md')",
    "readOptionalText('d1-insights/summary.md')",
    "readOptionalText('observability-summary.md')",
    "readOptionalText('telemetry-summary.md')",
    "process.env.LOOKBACK_MINUTES || '60'",
    'publishCommitStatuses',
    'upsertStatusIssue',
  ]);
  expectNone(publisher, [
    'node:assert',
    '--self-test',
    'function selfTest',
    'policy-self-test',
  ]);
  assert.doesNotMatch(publisher, /process\.env\.POLICY_OUTCOME/);
  expectAll(usageDocumentation, [
    '.github/workflows/hp-observability.yml',
    '.github/scripts/audit-cloudflare-daily-usage.py',
    'does not query usage or publish a separate status issue',
  ]);
});