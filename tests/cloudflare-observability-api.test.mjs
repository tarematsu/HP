import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';

const queryScript = readSource('.github/scripts/query-cloudflare-observability.py');
const auditScript = readSource('.github/scripts/audit-cloudflare-telemetry.py');
const auditUrl = new URL('../.github/scripts/audit-cloudflare-telemetry.py', import.meta.url);
const deployedAuditScript = readSource('.github/scripts/audit-deployed-cloudflare-telemetry.py');
const deployedAuditUrl = new URL('../.github/scripts/audit-deployed-cloudflare-telemetry.py', import.meta.url);
const dailyBudgetScript = readSource('.github/scripts/audit-cloudflare-daily-usage.py');
const d1QueryCostUrl = new URL('../.github/scripts/query-cloudflare-d1-costs.py', import.meta.url);
const d1QueryCostScript = readSource('.github/scripts/query-cloudflare-d1-costs.py');
const liveTailScript = readSource('.github/scripts/capture-cloudflare-live-tail.mjs');
const fullTelemetryWranglers = [
  'wrangler.sakurazaka46jp.jsonc',
  'wrangler.runtime.jsonc',
].map((name) => ({ name, source: readSource(`worker/${name}`) }));
const sampledTelemetryWranglers = [
  'wrangler.buddies-recovery.jsonc',
  'wrangler.buddies-collector.jsonc',
].map((name) => ({ name, source: readSource(`worker/${name}`) }));

test('query and audit scripts use resolved-account Cloudflare APIs without R2', () => {
  expectAll(queryScript, [
    'workersInvocationsAdaptive',
    'workers/observability/telemetry/query',
    '"view": "events"',
    'GITHUB_STEP_SUMMARY',
    'urlunsplit',
    'CLOUDFLARE_ACCOUNT_ID',
    '$metadata.error',
    '$metadata.level',
    'WARNING_LEVELS = {"warn", "warning"}',
    'for level in ("error", "fatal", "warn", "warning")',
    'persisted_error_events=',
    'persisted_warning_events=',
    'Cloudflare Worker warnings',
    'sanitize_text',
    'return 1 if total_errors or errors else 0',
  ]);
  expectNone(queryScript, [
    'discover_account_id',
    'accounts?per_page=50',
    'user/tokens/verify',
    '::warning title=Cloudflare Worker errors',
  ]);

  expectAll(auditScript, [
    'workers.get("cpuTimeMs")',
    '"view": "events"',
    '$workers.cpuTimeMs',
    'scriptVersion',
    'fromisoformat',
    'old_version_invocations_excluded',
    'LIVE_TAIL_EVENT=',
    '_diagnostic_source',
    'QUEUE_CPU_BUDGET_MS',
    'DURABLE_OBJECT_CPU_BUDGET_MS',
    'invocation_class',
    'cpu_limit_outcome',
    'budget_class',
    'queue_consumer_budget_ms',
    'coverage_ok',
    'missing_workers',
    'request_id',
    'all_events = merge_events',
    'error_items',
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
    'queueMessageOperationsAdaptiveGroups',
    'billableOperations',
    'linear-from-utc-midnight',
    'project_daily_usage',
    'rowsRead rowsWritten',
    'measuredRequests',
    'requestReserve',
    'queueOperations',
    'Actual to now',
    'Projected 24h',
  ]);
  expectNone(
    `${queryScript}\n${auditScript}\n${deployedAuditScript}\n${dailyBudgetScript}`,
    ['r2.cloudflarestorage', 'aws s3', 'R2_BUCKET'],
  );
});

test('telemetry audits enforce invocation-specific budgets, deployed versions, and deduplicated errors', () => {
  for (const url of [auditUrl, deployedAuditUrl]) {
    const result = spawnSync('python3', [fileURLToPath(url), '--self-test'], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  }
});

test('D1 query cost collector uses resolved-account GraphQL and passes its privacy self-test', () => {
  expectAll(d1QueryCostScript, [
    'd1QueriesAdaptiveGroups',
    'sum_rowsRead_DESC',
    'sum_rowsWritten_DESC',
    'count_DESC',
    'sanitize_query',
    'hashlib.sha256',
    'rowsRead',
    'rowsWritten',
    'D1 query cost insights',
    'CLOUDFLARE_ACCOUNT_ID',
    'resolved CLOUDFLARE_ACCOUNT_ID',
  ]);
  expectNone(d1QueryCostScript, [
    'REST_API',
    'def account_id',
    'accounts?per_page=50',
    'wrangler d1 insights',
    'spawnSync',
    'node_modules/.bin/wrangler',
    '/d1/database',
  ]);
  const result = spawnSync('python3', [fileURLToPath(d1QueryCostUrl), '--self-test'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('live-tail diagnostics use resolved context and shared credential redaction', () => {
  expectAll(liveTailScript, [
    'CLOUDFLARE_ACCOUNT_ID',
    'telemetry/live-tail',
    'scriptId: worker',
    './observability-status-publisher.mjs',
    'sanitizeText',
    '[redacted]',
  ]);
  assert.match(liveTailScript, /parsed\.protocol.*parsed\.host.*parsed\.pathname/s);
  expectNone(liveTailScript, [
    'async function accountId',
    'accounts?per_page=50',
    'console.log(token',
    'function redactCredentials',
  ]);
});

test('routine Workers retain full invocation telemetry while collector lanes sample invocation and application logs', () => {
  for (const { name, source } of fullTelemetryWranglers) {
    assert.match(source, /"observability"\s*:\s*\{/u, name);
    assert.match(source, /"enabled"\s*:\s*true/u, name);
    assert.match(source, /"persist"\s*:\s*true/u, name);
    assert.match(source, /"invocation_logs"\s*:\s*true/u, name);
    assert.doesNotMatch(source, /"logpush"\s*:\s*true/u, name);
  }
  for (const { name, source } of sampledTelemetryWranglers) {
    assert.match(source, /"observability"\s*:\s*\{/u, name);
    assert.match(source, /"enabled"\s*:\s*true/u, name);
    assert.match(source, /"head_sampling_rate"\s*:\s*0\.1/u, name);
    assert.match(source, /"persist"\s*:\s*true/u, name);
    assert.match(source, /"invocation_logs"\s*:\s*true/u, name);
    assert.doesNotMatch(source, /"logpush"\s*:\s*true/u, name);
  }
});
