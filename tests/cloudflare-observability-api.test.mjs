import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';

const queryScript = readSource('.github/scripts/query-cloudflare-observability.py');
const auditScript = readSource('.github/scripts/audit-cloudflare-telemetry.py');
const deployedAuditScript = readSource('.github/scripts/audit-deployed-cloudflare-telemetry.py');
const dailyBudgetScript = readSource('.github/scripts/audit-cloudflare-daily-usage.py');
const d1QueryCostUrl = new URL('../.github/scripts/query-cloudflare-d1-costs.py', import.meta.url);
const d1QueryCostScript = readSource('.github/scripts/query-cloudflare-d1-costs.py');
const liveTailScript = readSource('.github/scripts/capture-cloudflare-live-tail.mjs');
const wranglerFiles = [
  'wrangler.sakurazaka46jp.jsonc',
  'wrangler.buddies-collector.jsonc',
  'wrangler.runtime.jsonc',
].map((name) => ({ name, source: readSource(`worker/${name}`) }));

test('query and audit scripts use resolved-account Cloudflare APIs without R2', () => {
  expectAll(queryScript, [
    'workersInvocationsAdaptive',
    'workers/observability/telemetry/query',
    '"view": "events"',
    'GITHUB_STEP_SUMMARY',
    'urlunsplit',
    'CLOUDFLARE_ACCOUNT_ID',
  ]);
  expectNone(queryScript, ['discover_account_id', 'accounts?per_page=50', 'user/tokens/verify']);

  expectAll(auditScript, [
    'workers.get("cpuTimeMs")',
    '"view": "events"',
    '$workers.cpuTimeMs',
    'scriptVersion',
    'fromisoformat',
    'old_version_invocations_excluded',
    'LIVE_TAIL_EVENT=',
    '_diagnostic_source',
    'DURABLE_OBJECT_CPU_BUDGET_MS',
    'coverage_ok',
    'missing_workers',
    'incomplete coverage',
    'Worker CPU policy violation',
    'ACCOUNT_ID',
    'Cloudflare token, account ID, and Worker list are required',
  ]);
  expectNone(auditScript, ['def account_id', 'accounts?per_page=50']);

  expectAll(deployedAuditScript, [
    'workers/scripts/{encoded}/deployments',
    'deployments[0]',
    'percentage',
    'version_id',
    'deployed_current_events',
    'audit.current_events',
    'old_late',
    'audit.ACCOUNT_ID',
    'Cloudflare token, account ID, and Worker list are required',
  ]);
  expectNone(deployedAuditScript, ['audit.account_id()', 'accounts?per_page=50']);

  expectAll(dailyBudgetScript, [
    'workersInvocationsAdaptive',
    'd1AnalyticsAdaptiveGroups',
    'rowsRead rowsWritten',
    'measuredRequests',
    'requestReserve',
  ]);
  expectNone(
    `${queryScript}\n${auditScript}\n${deployedAuditScript}\n${dailyBudgetScript}`,
    ['r2.cloudflarestorage', 'aws s3', 'R2_BUCKET'],
  );
});

test('D1 query cost collector uses resolved-account GraphQL and passes its privacy self-test', () => {
  expectAll(d1QueryCostScript, [
    'd1QueriesAdaptiveGroups',
    'sum_rowsRead_DESC',
    'sum_rowsWritten_DESC',
    'count_DESC',
    'CLOUDFLARE_ACCOUNT_ID',
    'resolved CLOUDFLARE_ACCOUNT_ID',
  ]);
  expectNone(d1QueryCostScript, ['REST_API', 'def account_id', 'accounts?per_page=50', 'wrangler d1 insights']);
  const result = spawnSync('python3', [fileURLToPath(d1QueryCostUrl), '--self-test'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('live-tail diagnostics use resolved context and redact sensitive request fields', () => {
  expectAll(liveTailScript, [
    'CLOUDFLARE_ACCOUNT_ID',
    'telemetry/live-tail',
    'scriptId: worker',
    '[redacted]',
  ]);
  assert.match(liveTailScript, /parsed\.protocol.*parsed\.host.*parsed\.pathname/s);
  expectNone(liveTailScript, ['async function accountId', 'accounts?per_page=50', 'console.log(token']);
});

test('all deployed Workers persist invocation logs and disable Logpush export', () => {
  for (const { name, source } of wranglerFiles) {
    assert.match(source, /"observability"\s*:\s*\{/u, name);
    assert.match(source, /"enabled"\s*:\s*true/u, name);
    assert.match(source, /"persist"\s*:\s*true/u, name);
    assert.match(source, /"invocation_logs"\s*:\s*true/u, name);
    assert.doesNotMatch(source, /"logpush"\s*:\s*true/u, name);
  }
});
