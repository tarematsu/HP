import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);

function runSelfTest(path) {
  const result = spawnSync('python3', [path, '--self-test'], {
    cwd: rootPath,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${path} self-test failed:\n${result.stdout}\n${result.stderr}`);
}

test('observability policy scripts pass offline self-tests in CI', () => {
  for (const path of [
    '.github/scripts/audit-cloudflare-daily-usage.py',
    '.github/scripts/audit-cloudflare-free-tier.py',
    '.github/scripts/audit-observability-budget-gates.py',
    '.github/scripts/audit-cloudflare-telemetry.py',
    '.github/scripts/audit-deployed-cloudflare-telemetry.py',
  ]) runSelfTest(path);
});

test('observability script changes are covered by pull-request CI', () => {
  const workflow = readSource('.github/workflows/homepanel-unified-ci.yml');
  assert.match(workflow, /^\s{6}- '\.github\/scripts\/audit-cloudflare-daily-usage\.py'$/m);
  assert.match(workflow, /^\s{6}- '\.github\/scripts\/audit-deployed-cloudflare-telemetry\.py'$/m);
  assert.match(workflow, /needs\.changes\.outputs\.contracts == 'true'/);
});

test('unified observability runs account-wide post-deploy and daily gates', () => {
  const workflow = readSource('.github/workflows/sh-observability.yml');
  const dailyAudit = readSource('.github/scripts/audit-cloudflare-daily-usage.py');
  const freeTierAudit = readSource('.github/scripts/cloudflare_free_tier_audit.py');
  const budgetContract = readSource('.github/scripts/audit-observability-budget-gates.py');

  expectAll(workflow, [
    'name: Unified Cloudflare Observability',
    'workflows: ["Deploy production", "Deploy unified homepanel-cloud Worker"]',
    'branches: [main]',
    '.github/actions/cloudflare-observability-diagnostics/action.yml',
    '.github/scripts/publish-cloudflare-observability-status.mjs',
    'cron: "0 1 * * *"',
    'CLOUDFLARE_WORKERS: sh-sakurazaka46jp,sh-buddies-collector,sh-runtime-orchestrator,homepanel-cloud',
    'D1_CONFIG_GLOBS: worker/wrangler*.jsonc,site/wrangler.jsonc,hp/cloud/wrangler.jsonc',
    'DAILY_REQUEST_BUDGET: "100000"',
    'DAILY_REQUEST_RESERVE: "0"',
    'DAILY_D1_READ_BUDGET: "5000000"',
    'DAILY_D1_WRITE_BUDGET: "100000"',
    'DAILY_QUEUE_BUDGET: "10000"',
    'CLOUDFLARE_RUNTIME_WORKER: sh-runtime-orchestrator',
    'CLOUDFLARE_KV_BINDINGS: PAGES_RESPONSE_KV',
    'CLOUDFLARE_DO_BINDINGS: RUNTIME_COORDINATOR,BUDDIES_COLLECTOR_COORDINATOR,SCHEDULER_COORDINATOR',
    'id: free-tier-budget',
    'id: budget-contract',
    'id: d1-insights',
    'id: observability-query',
    'id: telemetry-policy',
    'id: publish-status',
    'D1_INSIGHTS_OUTCOME',
    'cloudflare-observability-report-unified-',
    'Fail after collecting diagnostics when any observability gate fails',
    'observability-gate/',
    'd1-insights/',
  ]);
  expectNone(workflow, [
    'publish-homepanel-observability-status.mjs',
    'cloudflare-observability-report-sh-',
    'cloudflare-observability-report-hp-',
    '--self-test',
    'node --test',
    'policy-self-test',
    'observability/policy-self-test',
  ]);
  assert.doesNotMatch(workflow, /^\s+POLICY_OUTCOME:/m);
  assert.doesNotMatch(workflow, /^\s+pull_request:/m);
  assert.equal((workflow.match(/- cron:/g) || []).length, 1);
  assert.equal((workflow.match(/continue-on-error: true/g) || []).length, 7);

  expectAll(dailyAudit, [
    'def configured_resources()',
    'queueMessageOperationsAdaptiveGroups',
    'configured_queue_ids',
    'Projected 24h',
    'ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID"',
  ]);
  expectAll(freeTierAudit, [
    'def aggregate(row:',
    'ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID"',
  ]);
  expectAll(budgetContract, [
    'DAILY_METRICS = ("requests", "rowsRead", "rowsWritten", "queueOperations")',
    'daily.usage.queueCount',
    'Daily metrics checked: `{len(DAILY_METRICS)}`',
  ]);
});

test('manual D1 workflow remains manual-only and duplicate status workflows are gone', async () => {
  const workflow = readSource('.github/workflows/fetch-cloudflare-d1-usage.yml');
  assert.match(workflow, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(?:pull_request|schedule):/m);
  for (const path of [
    '.github/workflows/hp-observability.yml',
    '.github/scripts/publish-homepanel-observability-status.mjs',
    '.github/workflows/cloudflare-worker-request-budget.yml',
    'scripts/cloudflare-worker-request-budget.mjs',
    '.github/scripts/audit-cloudflare-live-tail.py',
    '.github/scripts/audit-cloudflare-free-tier-account.py',
    '.github/scripts/audit-cloudflare-free-tier-core.py',
  ]) await assert.rejects(access(new URL(path, root)), path);
});
