import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const queryScript = readFileSync(
  new URL('../.github/scripts/query-cloudflare-observability.py', import.meta.url),
  'utf8',
);
const auditScript = readFileSync(
  new URL('../.github/scripts/audit-cloudflare-telemetry.py', import.meta.url),
  'utf8',
);
const deployedAuditScript = readFileSync(
  new URL('../.github/scripts/audit-deployed-cloudflare-telemetry.py', import.meta.url),
  'utf8',
);
const dailyBudgetScript = readFileSync(
  new URL('../.github/scripts/audit-cloudflare-daily-usage.py', import.meta.url),
  'utf8',
);
const d1QueryCostUrl = new URL(
  '../.github/scripts/query-cloudflare-d1-costs.py',
  import.meta.url,
);
const d1QueryCostScript = readFileSync(d1QueryCostUrl, 'utf8');
const liveTailScript = readFileSync(
  new URL('../.github/scripts/capture-cloudflare-live-tail.mjs', import.meta.url),
  'utf8',
);
const wranglerFiles = [
  'wrangler.sakurazaka46jp.jsonc',
  'wrangler.buddies-collector.jsonc',
  'wrangler.runtime.jsonc',
].map((name) => ({
  name,
  source: readFileSync(new URL(`../worker/${name}`, import.meta.url), 'utf8'),
}));

test('query and audit scripts use resolved-account Cloudflare APIs without R2', () => {
  assert.match(queryScript, /workersInvocationsAdaptive/);
  assert.match(queryScript, /workers\/observability\/telemetry\/query/);
  assert.match(queryScript, /"view": "events"/);
  assert.match(queryScript, /GITHUB_STEP_SUMMARY/);
  assert.match(queryScript, /urlunsplit/);
  assert.match(queryScript, /CLOUDFLARE_ACCOUNT_ID/);
  assert.doesNotMatch(queryScript, /discover_account_id|accounts\?per_page=50|user\/tokens\/verify/);

  assert.match(auditScript, /workers\.get\("cpuTimeMs"\)/);
  assert.match(auditScript, /"view": "events"/);
  assert.match(auditScript, /\$workers\.cpuTimeMs/);
  assert.match(auditScript, /scriptVersion/);
  assert.match(auditScript, /fromisoformat/);
  assert.match(auditScript, /old_version_invocations_excluded/);
  assert.match(auditScript, /LIVE_TAIL_EVENT=/);
  assert.match(auditScript, /_diagnostic_source/);
  assert.match(auditScript, /DURABLE_OBJECT_CPU_BUDGET_MS/);
  assert.match(auditScript, /coverage_ok/);
  assert.match(auditScript, /missing_workers/);
  assert.match(auditScript, /incomplete coverage/);
  assert.match(auditScript, /Worker CPU policy violation/);
  assert.match(auditScript, /ACCOUNT_ID/);
  assert.match(auditScript, /Cloudflare token, account ID, and Worker list are required/);
  assert.doesNotMatch(auditScript, /def account_id|accounts\?per_page=50/);

  assert.match(deployedAuditScript, /workers\/scripts\/\{encoded\}\/deployments/);
  assert.match(deployedAuditScript, /deployments\[0\]/);
  assert.match(deployedAuditScript, /percentage/);
  assert.match(deployedAuditScript, /version_id/);
  assert.match(deployedAuditScript, /deployed_current_events/);
  assert.match(deployedAuditScript, /audit\.current_events/);
  assert.match(deployedAuditScript, /old_late/);
  assert.match(deployedAuditScript, /audit\.ACCOUNT_ID/);
  assert.match(deployedAuditScript, /Cloudflare token, account ID, and Worker list are required/);
  assert.doesNotMatch(deployedAuditScript, /audit\.account_id\(\)|accounts\?per_page=50/);

  assert.match(dailyBudgetScript, /workersInvocationsAdaptive/);
  assert.match(dailyBudgetScript, /d1AnalyticsAdaptiveGroups/);
  assert.match(dailyBudgetScript, /rowsRead rowsWritten/);
  assert.match(dailyBudgetScript, /measuredRequests/);
  assert.match(dailyBudgetScript, /requestReserve/);
  assert.doesNotMatch(
    `${queryScript}\n${auditScript}\n${deployedAuditScript}\n${dailyBudgetScript}`,
    /r2\.cloudflarestorage|aws s3|R2_BUCKET/,
  );
});

test('D1 query cost collector uses resolved-account GraphQL and passes its privacy self-test', () => {
  assert.match(d1QueryCostScript, /d1QueriesAdaptiveGroups/);
  assert.match(d1QueryCostScript, /sum_rowsRead_DESC/);
  assert.match(d1QueryCostScript, /sum_rowsWritten_DESC/);
  assert.match(d1QueryCostScript, /count_DESC/);
  assert.match(d1QueryCostScript, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(d1QueryCostScript, /resolved CLOUDFLARE_ACCOUNT_ID/);
  assert.doesNotMatch(d1QueryCostScript, /REST_API|def account_id|accounts\?per_page=50|wrangler d1 insights/);
  const result = spawnSync('python3', [fileURLToPath(d1QueryCostUrl), '--self-test'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('live-tail diagnostics use resolved context and redact sensitive request fields', () => {
  assert.match(liveTailScript, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(liveTailScript, /telemetry\/live-tail/);
  assert.match(liveTailScript, /scriptId: worker/);
  assert.match(liveTailScript, /\[redacted\]/);
  assert.match(liveTailScript, /parsed\.protocol.*parsed\.host.*parsed\.pathname/s);
  assert.doesNotMatch(liveTailScript, /async function accountId|accounts\?per_page=50/);
  assert.doesNotMatch(liveTailScript, /console\.log\(.*token/);
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
