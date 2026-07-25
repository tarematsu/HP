#!/usr/bin/env python3
from __future__ import annotations

import re
import runpy
from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one occurrence, found {count}: {old[:140]!r}")
    write(path, text.replace(old, new, 1))


def replace_regex(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: regex did not match exactly once: {pattern[:180]!r}")
    write(path, updated)


try:
    runpy.run_path(".github/scripts/pr260_apply_homepanel_observability_fix.py", run_name="__main__")
except SystemExit as error:
    detail = str(error)
    expected = ".github/workflows/hp-observability.yml: expected one occurrence, found 0"
    if expected not in detail or "Enforce current-version persisted and live CPU policy" not in detail:
        raise

workflow = ".github/workflows/hp-observability.yml"
replace_regex(
    workflow,
    r'''\n      - name: Enforce current-version persisted and live CPU policy.*?\n\n      - name: Publish persistent observability status''',
    '''
      - name: Enforce current-deployment persisted and live CPU policy
        id: telemetry-policy
        continue-on-error: true
        env:
          LIVE_TAIL_LOG: live-tail.log
          ACTIVE_WORKER_DEPLOYMENTS_OUTPUT: active-worker-deployments.json
        shell: bash
        run: |
          set -o pipefail
          actual_summary="$GITHUB_STEP_SUMMARY"
          GITHUB_STEP_SUMMARY=telemetry-summary.md \\
            python3 .github/scripts/audit-deployed-cloudflare-telemetry.py 2>&1 | tee telemetry-audit.log
          status=${PIPESTATUS[0]}
          if [[ -f telemetry-summary.md ]]; then
            cat telemetry-summary.md >> "$actual_summary"
          fi
          exit "$status"

      - name: Publish persistent observability status''',
)
replace_once(
    workflow,
    '''            telemetry-summary.md
            telemetry-audit.log
            live-tail.log
''',
    '''            telemetry-summary.md
            telemetry-audit.log
            active-worker-deployments.json
            live-tail.log
''',
)

publisher = ".github/scripts/publish-homepanel-observability-status.mjs"
replace_once(
    publisher,
    '''  publishCommitStatuses,
  readOptionalText,
''',
    '''  publishCommitStatuses,
  readOptionalJson,
  readOptionalText,
''',
)
replace_once(
    publisher,
    '''const STATUS_CONTEXTS = {
  daily: 'observability/daily-usage-budget',
  d1Insights: 'observability/d1-query-insights',
  query: 'observability/cloudflare-query',
  telemetry: 'observability/telemetry-policy',
};

export function buildIssueBody({
''',
    '''const STATUS_CONTEXTS = {
  daily: 'observability/daily-usage-budget',
  d1Insights: 'observability/d1-query-insights',
  query: 'observability/cloudflare-query',
  telemetry: 'observability/telemetry-policy',
};

function deploymentSummary(activeDeployments) {
  const entries = Object.entries(activeDeployments || {});
  const rows = entries.length
    ? entries.map(([worker, deployment]) => {
        const versions = Array.isArray(deployment?.version_ids)
          ? deployment.version_ids.join(', ')
          : String(deployment?.version_ids || 'unknown');
        return `| \\`${worker}\\` | \\`${deployment?.status || 'unknown'}\\` | \\`${deployment?.deployment_id || 'unknown'}\\` | \\`${versions || 'unknown'}\\` | ${deployment?.created_on || 'unknown'} |`;
      }).join('\\n')
    : '| - | not captured | not captured | not captured | not captured |';
  return `### Active Worker deployments\\n\\n| Worker | Status | Deployment | Traffic-bearing versions | Deployed at |\\n|---|---|---|---|---|\\n${rows}`;
}

export function buildIssueBody({
''',
)
replace_once(
    publisher,
    '''  outcomes,
  summaries = {},
}) {
''',
    '''  outcomes,
  summaries = {},
  activeDeployments = {},
}) {
''',
)
replace_once(
    publisher,
    '''- **Commit:** \\`${targetSha}\\`
- **Workflow run:** ${runUrl}
- **Telemetry and D1 insights lookback:** ${lookbackMinutes} minutes

| Gate | Outcome |
''',
    '''- **Workflow source commit:** \\`${targetSha}\\`
- **Workflow run:** ${runUrl}
- **Telemetry and D1 insights lookback:** ${lookbackMinutes} minutes

${deploymentSummary(activeDeployments)}

| Gate | Outcome |
''',
)
replace_once(
    publisher,
    '''  const [daily, d1Insights, observability, telemetry] = await Promise.all([
    readOptionalText('daily-usage/summary.md'),
    readOptionalText('d1-insights/summary.md'),
    readOptionalText('observability-summary.md'),
    readOptionalText('telemetry-summary.md'),
  ]);
''',
    '''  const [daily, d1Insights, observability, telemetry, activeDeployments] = await Promise.all([
    readOptionalText('daily-usage/summary.md'),
    readOptionalText('d1-insights/summary.md'),
    readOptionalText('observability-summary.md'),
    readOptionalText('telemetry-summary.md'),
    readOptionalJson('active-worker-deployments.json', {}),
  ]);
''',
)
replace_once(
    publisher,
    '''    outcomes,
    summaries: { daily, d1Insights, observability, telemetry },
  });
''',
    '''    outcomes,
    summaries: { daily, d1Insights, observability, telemetry },
    activeDeployments,
  });
''',
)

unified = ".github/workflows/homepanel-unified-ci.yml"
replace_once(
    unified,
    '''          python3 .github/scripts/audit-cloudflare-telemetry.py --self-test
          python3 .github/scripts/query-cloudflare-d1-costs.py --self-test
''',
    '''          python3 .github/scripts/audit-cloudflare-telemetry.py --self-test
          python3 .github/scripts/audit-deployed-cloudflare-telemetry.py --self-test
          python3 .github/scripts/query-cloudflare-d1-costs.py --self-test
''',
)

api_test = "tests/cloudflare-observability-api.test.mjs"
replace_once(
    api_test,
    '''const deployedAuditScript = readSource('.github/scripts/audit-deployed-cloudflare-telemetry.py');
''',
    '''const deployedAuditScript = readSource('.github/scripts/audit-deployed-cloudflare-telemetry.py');
const deployedAuditUrl = new URL('../.github/scripts/audit-deployed-cloudflare-telemetry.py', import.meta.url);
''',
)
replace_once(
    api_test,
    '''    'DURABLE_OBJECT_CPU_BUDGET_MS',
    'coverage_ok',
''',
    '''    'QUEUE_CPU_BUDGET_MS',
    'DURABLE_OBJECT_CPU_BUDGET_MS',
    'invocation_class',
    'cpu_limit_outcome',
    'budget_class',
    'queue_consumer_budget_ms',
    'coverage_ok',
''',
)
replace_once(
    api_test,
    '''test('telemetry audit filters live and persisted events to one version and deduplicates invocation errors', () => {
  const result = spawnSync('python3', [fileURLToPath(auditUrl), '--self-test'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\\n${result.stderr}`);
});
''',
    '''test('telemetry audits enforce invocation-specific budgets, deployed versions, and deduplicated errors', () => {
  for (const url of [auditUrl, deployedAuditUrl]) {
    const result = spawnSync('python3', [fileURLToPath(url), '--self-test'], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\\n${result.stderr}`);
  }
});
''',
)

contract = "tests/homepanel-observability-contract.test.mjs"
replace_once(
    contract,
    '''import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';
''',
    '''import { buildIssueBody } from '../.github/scripts/publish-homepanel-observability-status.mjs';
import { expectAll, expectNone, readSource } from './helpers/source-contract.mjs';
''',
)
replace_once(
    contract,
    '''    'DAILY_QUEUE_BUDGET: "10000"',
    'Enforce projected UTC daily Worker, D1, and Queue budgets',
''',
    '''    'DAILY_QUEUE_BUDGET: "10000"',
    'QUEUE_CPU_BUDGET_MS: "30000"',
    'Select safe diagnostic trigger',
    'Defer deploy-affecting pushes to workflow_run',
    'Deferring HomePanel diagnostics until unified Worker deployment completes.',
    'needs.classify.outputs.run',
    'Enforce projected UTC daily Worker, D1, and Queue budgets',
''',
)
replace_once(
    contract,
    '''    'telemetry-summary.md',
    'Publish persistent observability status',
''',
    '''    'telemetry-summary.md',
    'audit-deployed-cloudflare-telemetry.py',
    'ACTIVE_WORKER_DEPLOYMENTS_OUTPUT: active-worker-deployments.json',
    'active-worker-deployments.json',
    'Publish persistent observability status',
''',
)
replace_once(
    contract,
    '''    'python3 .github/scripts/audit-cloudflare-telemetry.py --self-test',
    'python3 .github/scripts/query-cloudflare-d1-costs.py --self-test',
''',
    '''    'python3 .github/scripts/audit-cloudflare-telemetry.py --self-test',
    'python3 .github/scripts/audit-deployed-cloudflare-telemetry.py --self-test',
    'python3 .github/scripts/query-cloudflare-d1-costs.py --self-test',
''',
)
replace_once(
    contract,
    '''    "readOptionalText('telemetry-summary.md')",
    "process.env.LOOKBACK_MINUTES || '60'",
''',
    '''    "readOptionalText('telemetry-summary.md')",
    "readOptionalJson('active-worker-deployments.json', {})",
    'Active Worker deployments',
    'Workflow source commit',
    "process.env.LOOKBACK_MINUTES || '60'",
''',
)
replace_once(
    contract,
    '''  assert.doesNotMatch(publisher, /process\\.env\\.POLICY_OUTCOME/);
  expectAll(usageDocumentation, [
''',
    '''  assert.doesNotMatch(publisher, /process\\.env\\.POLICY_OUTCOME/);
  const issueBody = buildIssueBody({
    generatedAt: '2026-07-25T00:00:00.000Z',
    targetSha: 'abc123',
    runUrl: 'https://github.com/tarematsu/HP/actions/runs/1',
    trigger: 'workflow_run',
    lookbackMinutes: '60',
    outcomes: { daily: 'success', d1Insights: 'success', query: 'success', telemetry: 'success' },
    activeDeployments: {
      'homepanel-cloud': {
        status: 'active',
        deployment_id: 'deployment-1',
        version_ids: ['version-1'],
        created_on: '2026-07-25T00:00:00Z',
      },
    },
  });
  assert.match(issueBody, /Workflow source commit.*abc123/s);
  assert.match(issueBody, /Active Worker deployments/);
  assert.match(issueBody, /deployment-1/);
  assert.match(issueBody, /version-1/);
  expectAll(usageDocumentation, [
''',
)

print("Finished HomePanel observability contract fixes")
