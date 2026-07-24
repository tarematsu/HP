import assert from 'node:assert/strict';
import test from 'node:test';

import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';

test('HomePanel observability workflow keeps the production contract', () => {
  const workflow = readSource('.github/workflows/hp-observability.yml');
  const unifiedCi = readSource('.github/workflows/homepanel-unified-ci.yml');
  const diagnostics = readSource('.github/actions/cloudflare-observability-diagnostics/action.yml');

  expectAll(workflow, [
    'workflows: ["Deploy unified homepanel-cloud Worker"]',
    'cron: "47 2 * * *"',
    'issues: write',
    'statuses: write',
    'D1_CONFIG_GLOBS: hp/cloud/wrangler.jsonc',
    'D1_DATABASE_NAME: homepanel-data',
    'DAILY_REQUEST_BUDGET: "3000"',
    'DAILY_REQUEST_RESERVE: "0"',
    'DAILY_D1_READ_BUDGET: "50000"',
    'DAILY_D1_WRITE_BUDGET: "3000"',
    'DAILY_QUEUE_BUDGET: "1000"',
    'Enforce projected UTC daily Worker, D1, and Queue budgets',
    'Collect top D1 queries by rows read',
    'query-cloudflare-d1-insights.mjs',
    'D1_INSIGHTS_OUTCOME',
    'id: observability-query',
    'uses: ./.github/actions/cloudflare-observability-diagnostics',
    'live-tail-worker: homepanel-cloud',
    'live-tail-seconds: "90"',
    'live-tail-probes: /v1/health,/',
    'LIVE_TAIL_LOG: live-tail.log',
    'telemetry-summary.md',
    'Publish persistent observability status',
    'publish-homepanel-observability-status.mjs',
    'steps.publish-status.outcome',
    'if: always()',
    'set -o pipefail',
    'retention-days: 1',
    'tests/homepanel-observability-contract.test.mjs',
    'tests/observability-status-publisher.test.mjs',
  ]);
  expectAll(unifiedCi, ['tests/homepanel-*.test.mjs']);
  expectAll(diagnostics, [
    'query-cloudflare-observability.py',
    'capture-cloudflare-live-tail.mjs',
    'wait "$query_pid" || query_status=$?',
    'wait "$tail_pid" || true',
    'exit "$query_status"',
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
    'publish-homepanel-observability-status.mjs --self-test',
    'tests/homepanel-*.test.mjs',
    'tests/homepanel-runtime-contract.test.mjs',
    'tests/homepanel-video-contract.test.mjs',
    'tests/homepanel-migrations-contract.test.mjs',
  ]);
  assert.equal(workflow.match(/cron: "/g)?.length, 1);
  assert.ok(workflow.includes('\n  push:'));
  assert.ok(workflow.includes('branches: [main]'));
});

test('HomePanel observability tools retain budget, privacy, and status behavior', () => {
  const daily = readSource('.github/scripts/audit-cloudflare-daily-usage.py');
  const telemetry = readSource('.github/scripts/audit-cloudflare-telemetry.py');
  const insights = readSource('.github/scripts/query-cloudflare-d1-insights.mjs');
  const publisher = readSource('.github/scripts/publish-homepanel-observability-status.mjs');
  const publisherCore = readSource('.github/scripts/observability-status-publisher.mjs');
  const configResolver = readSource('.github/scripts/resolve-cloudflare-config.mjs');
  const usageDocumentation = readSource('hp/cloud/D1_USAGE_MEASUREMENT.md');

  expectAll(daily, [
    'queueMessageOperationsAdaptiveGroups',
    'billableOperations',
    'linear-from-utc-midnight',
    'project_daily_usage',
    'queueOperations',
    'Actual to now',
    'Projected 24h',
  ]);
  expectAll(insights, [
    'wrangler',
    'd1',
    'insights',
    '--sort-by',
    'reads',
    'totalRowsRead',
    'sanitizeQuery',
    'SQL fingerprint',
    'redactText',
  ]);
  expectAll(telemetry, [
    'scriptVersion',
    'fromisoformat',
    'old_version_invocations_excluded',
    'LIVE_TAIL_EVENT=',
    'missing_workers',
    'DURABLE_OBJECT_CPU_BUDGET_MS',
  ]);
  expectAll(publisher, [
    'HomePanel Observability Status',
    '<!-- homepanel-observability-status -->',
    './observability-status-publisher.mjs',
    'observability/d1-query-insights',
    'Top D1 queries by rows read',
    'publishCommitStatuses',
    'upsertStatusIssue',
  ]);
  expectNone(publisher, ['node:assert', '--self-test', 'function selfTest']);
  expectAll(publisherCore, [
    'MAX_SECTION_CHARS = 12_000',
    'MAX_ISSUE_BODY_CHARS = 60_000',
    "context: 'observability/overall'",
    'upsertStatusIssue',
    'Bearer [redacted]',
    'CLOUDFLARE_(?:API_TOKEN|BUILDS_API_TOKEN|ACCOUNT_ID)',
  ]);
  expectAll(configResolver, [
    './resolve-cloudflare-account.mjs',
    'resolveCloudflareAccountId',
    'GITHUB_OUTPUT',
    'worker_name',
    'database_name',
    'account_id',
    'update_bucket',
  ]);
  expectNone(configResolver, [
    'd1AnalyticsAdaptiveGroups',
    '.cloudflare-build-diagnostics',
    'publishD1UsageIssue',
    'api.github.com',
    'GH_TOKEN',
  ]);
  expectAll(usageDocumentation, [
    '.github/workflows/hp-observability.yml',
    '.github/scripts/audit-cloudflare-daily-usage.py',
    'does not query usage or publish a separate status issue',
  ]);
  assert.ok(!telemetry.includes('R2_BUCKET'));
});
