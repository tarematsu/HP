import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const rootPath = fileURLToPath(root);

function runSelfTest(path) {
  const result = spawnSync('python3', [path, '--self-test'], {
    cwd: rootPath,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${path} self-test failed:\n${result.stdout}\n${result.stderr}`);
}

test('observability policy scripts pass offline self-tests', () => {
  runSelfTest('.github/scripts/audit-cloudflare-daily-usage.py');
  runSelfTest('.github/scripts/audit-cloudflare-free-tier.py');
  runSelfTest('.github/scripts/audit-observability-budget-gates.py');
  runSelfTest('.github/scripts/audit-cloudflare-telemetry.py');
  runSelfTest('.github/scripts/audit-deployed-cloudflare-telemetry.py');
});

test('observability script changes are covered by pull-request CI', async () => {
  const ci = await readFile(new URL('.github/workflows/ci.yml', root), 'utf8');
  assert.match(ci, /^\s{6}- '\.github\/scripts\/\*\*'$/m);
});

test('observability uses post-deploy, diagnostic-change, and daily complete budget checks', async () => {
  const workflow = await readFile(new URL('.github/workflows/sh-observability.yml', root), 'utf8');
  const dailyAudit = await readFile(
    new URL('.github/scripts/audit-cloudflare-daily-usage.py', root),
    'utf8',
  );
  const freeTierAudit = [
    await readFile(new URL('.github/scripts/cloudflare_free_tier_audit.py', root), 'utf8'),
    await readFile(new URL('.github/scripts/audit-cloudflare-free-tier-core.py', root), 'utf8'),
  ].join('\n');
  assert.match(workflow, /workflows: \["Deploy production"\]/);
  assert.match(workflow, /^\s+push:/m);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /\.github\/actions\/cloudflare-observability-diagnostics\/action\.yml/);
  assert.match(workflow, /\.github\/scripts\/publish-cloudflare-observability-status\.mjs/);
  assert.doesNotMatch(workflow, /^\s{6}- '(?:worker|site|packages)\//m);
  assert.doesNotMatch(workflow, /cron: "37 \* \* \* \*"/);
  assert.match(workflow, /cron: "0 1 \* \* \*"/);
  assert.equal((workflow.match(/- cron:/g) || []).length, 1);
  assert.doesNotMatch(workflow, /^\s+pull_request:/m);
  assert.match(workflow, /DAILY_REQUEST_BUDGET: "70000"/);
  assert.match(workflow, /DAILY_REQUEST_RESERVE: "0"/);
  assert.match(workflow, /DAILY_D1_READ_BUDGET: "3000000"/);
  assert.match(workflow, /DAILY_D1_WRITE_BUDGET: "70000"/);
  assert.match(workflow, /CLOUDFLARE_RUNTIME_WORKER: sh-runtime-orchestrator/);
  assert.match(workflow, /CLOUDFLARE_KV_BINDINGS: PAGES_RESPONSE_KV/);
  assert.match(workflow, /CLOUDFLARE_DO_BINDINGS: RUNTIME_COORDINATOR/);
  assert.match(workflow, /audit-cloudflare-free-tier\.py --self-test/);
  assert.doesNotMatch(workflow, /audit-cloudflare-free-tier-account\.py/);
  assert.match(workflow, /audit-observability-budget-gates\.py --self-test/);
  assert.match(workflow, /audit-deployed-cloudflare-telemetry\.py --self-test/);
  assert.match(workflow, /tests\/cloudflare-observability-status\.test\.mjs/);
  assert.match(workflow, /tests\/observability-status-publisher\.test\.mjs/);
  assert.match(dailyAudit, /def configured_resources\(\)/);
  assert.match(dailyAudit, /queueMessageOperationsAdaptiveGroups/);
  assert.match(dailyAudit, /configured_queue_ids/);
  assert.match(dailyAudit, /Projected 24h/);
  assert.match(freeTierAudit, /configured_resource_ids/);
  assert.doesNotMatch(
    freeTierAudit,
    /def (?:paginated|resource_ids|durable_object_namespace_ids)\(|workers\/durable_objects\/namespaces/,
  );
  assert.match(workflow, /id: free-tier-budget/);
  assert.match(workflow, /id: budget-contract/);
  assert.match(workflow, /id: observability-query/);
  assert.match(workflow, /id: telemetry-policy/);
  assert.match(workflow, /id: publish-status/);
  assert.match(workflow, /steps\.free-tier-budget\.outcome == 'failure'/);
  assert.match(workflow, /steps\.budget-contract\.outcome == 'failure'/);
  assert.match(workflow, /steps\.observability-query\.outcome == 'failure'/);
  assert.match(workflow, /steps\.telemetry-policy\.outcome == 'failure'/);
  assert.match(workflow, /steps\.publish-status\.outcome == 'failure'/);
  assert.match(workflow, /uses: \.\/\.github\/actions\/cloudflare-observability-diagnostics/);
  assert.match(workflow, /live-tail-worker: sh-runtime-orchestrator/);
  assert.match(workflow, /live-tail-seconds: "90"/);
  assert.match(workflow, /LIVE_TAIL_LOG: live-tail\.log/);
  assert.match(workflow, /audit-cloudflare-telemetry\.py --self-test/);
  assert.doesNotMatch(workflow, /audit-cloudflare-live-tail\.py/);
  assert.match(workflow, /id: daily-budget/);
  assert.equal((workflow.match(/continue-on-error: true/g) || []).length, 6);
  assert.match(workflow, /steps\.daily-budget\.outcome == 'failure'/);
  assert.match(workflow, /Fail after collecting diagnostics when any observability gate fails/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /observability-gate\//);
  assert.match(workflow, /observability-budget-gate\.log/);
});

test('D1 query insights are manual-only and duplicate budget paths are gone', async () => {
  const workflow = await readFile(new URL('.github/workflows/fetch-cloudflare-d1-usage.yml', root), 'utf8');
  assert.match(workflow, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+pull_request:/m);
  assert.doesNotMatch(workflow, /^\s+schedule:/m);
  await assert.rejects(access(new URL('.github/workflows/cloudflare-worker-request-budget.yml', root)));
  await assert.rejects(access(new URL('scripts/cloudflare-worker-request-budget.mjs', root)));
  await assert.rejects(access(new URL('.github/scripts/audit-cloudflare-live-tail.py', root)));
  await assert.rejects(access(new URL('.github/scripts/audit-cloudflare-free-tier-account.py', root)));
});
