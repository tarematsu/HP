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
  assert.match(readSource('.github/workflows/ci.yml'), /^\s{6}- '\.github\/scripts\/\*\*'$/m);
});

test('SH observability runs measured post-deploy and daily gates without repeating CI self-tests', () => {
  const workflow = readSource('.github/workflows/sh-observability.yml');
  const dailyAudit = readSource('.github/scripts/audit-cloudflare-daily-usage.py');
  const freeTierAudit = readSource('.github/scripts/cloudflare_free_tier_audit.py');

  expectAll(workflow, [
    'workflows: ["Deploy production"]',
    'branches: [main]',
    '.github/actions/cloudflare-observability-diagnostics/action.yml',
    '.github/scripts/publish-cloudflare-observability-status.mjs',
    'cron: "0 1 * * *"',
    'DAILY_REQUEST_BUDGET: "100000"',
    'DAILY_REQUEST_RESERVE: "0"',
    'DAILY_D1_READ_BUDGET: "5000000"',
    'DAILY_D1_WRITE_BUDGET: "100000"',
    'DAILY_QUEUE_BUDGET: "10000"',
    'CLOUDFLARE_RUNTIME_WORKER: sh-runtime-orchestrator',
    'CLOUDFLARE_KV_BINDINGS: PAGES_RESPONSE_KV',
    'CLOUDFLARE_DO_BINDINGS: RUNTIME_COORDINATOR,BUDDIES_COLLECTOR_COORDINATOR',
    'id: free-tier-budget',
    'id: budget-contract',
    'id: observability-query',
    'id: telemetry-policy',
    'id: publish-status',
    "steps.free-tier-budget.outcome == 'failure'",
    "steps.budget-contract.outcome == 'failure'",
    "steps.observability-query.outcome == 'failure'",
    "steps.telemetry-policy.outcome == 'failure'",
    "steps.publish-status.outcome == 'failure'",
    'uses: ./.github/actions/cloudflare-observability-diagnostics',
    'live-tail-worker: sh-runtime-orchestrator',
    'live-tail-seconds: "90"',
    'LIVE_TAIL_LOG: live-tail.log',
    'id: daily-budget',
    "steps.daily-budget.outcome == 'failure'",
    'Fail after collecting diagnostics when any observability gate fails',
    'if: always()',
    'observability-gate/',
    'observability-budget-gate.log',
  ]);
  expectNone(workflow, [
    'cron: "37 * * * *"',
    'CLOUDFLARE_PIPELINE_NAMES',
    'Pipelines included-usage',
    'audit-cloudflare-free-tier-account.py',
    'audit-cloudflare-live-tail.py',
    '--self-test',
    'node --test',
    'policy-self-test',
    'observability/policy-self-test',
    'tests/cloudflare-observability-status.test.mjs',
    'tests/observability-status-publisher.test.mjs',
  ]);
  assert.doesNotMatch(workflow, /^\s+POLICY_OUTCOME:/m);
  assert.doesNotMatch(workflow, /^\s{6}- '(?:worker|site|packages)\//m);
  assert.doesNotMatch(workflow, /^\s+pull_request:/m);
  assert.equal((workflow.match(/- cron:/g) || []).length, 1);
  assert.equal((workflow.match(/continue-on-error: true/g) || []).length, 6);

  expectAll(dailyAudit, [
    'def configured_resources()',
    'queueMessageOperationsAdaptiveGroups',
    'configured_queue_ids',
    'Projected 24h',
    'ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID"',
  ]);
  expectNone(dailyAudit, ['def account_id', 'accounts?per_page=50', 'urllib.parse']);
  expectAll(freeTierAudit, [
    'def aggregate(row:',
    'ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID"',
  ]);
  assert.doesNotMatch(
    freeTierAudit,
    /configured_resource_ids|importlib\.util|audit-cloudflare-free-tier-core|def (?:paginated|resource_ids|durable_object_namespace_ids)\(|workers\/durable_objects\/namespaces|PIPELINE_NAMES|pipelines\/v1\/pipelines/,
  );
});

test('D1 query insights are manual-only and duplicate budget paths are gone', async () => {
  const workflow = readSource('.github/workflows/fetch-cloudflare-d1-usage.yml');
  assert.match(workflow, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(?:pull_request|schedule):/m);
  for (const path of [
    '.github/workflows/cloudflare-worker-request-budget.yml',
    'scripts/cloudflare-worker-request-budget.mjs',
    '.github/scripts/audit-cloudflare-live-tail.py',
    '.github/scripts/audit-cloudflare-free-tier-account.py',
    '.github/scripts/audit-cloudflare-free-tier-core.py',
  ]) await assert.rejects(access(new URL(path, root)), path);
});