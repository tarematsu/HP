#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  MAX_ISSUE_BODY_CHARS,
  clipText,
  createGitHubRequest,
  overallOutcome,
  publishCommitStatuses,
  readOptionalJson,
  readOptionalText,
  renderOutcomeRows,
  renderSection,
  requiredEnv,
  upsertStatusIssue,
} from './observability-status-publisher.mjs';

export const STATUS_ISSUE_TITLE = 'Cloudflare Observability Status';
export const STATUS_MARKER = '<!-- cloudflare-observability-status -->';

const STATUS_CONTEXTS = {
  daily: 'observability/daily-usage-budget',
  freeTier: 'observability/free-tier-budget',
  contract: 'observability/budget-contract',
  d1Insights: 'observability/d1-query-insights',
  query: 'observability/cloudflare-query',
  telemetry: 'observability/telemetry-policy',
};

export function isCurrentMainTarget(targetSha, mainSha) {
  const target = String(targetSha || '').trim();
  const current = String(mainSha || '').trim();
  return Boolean(target && current && current !== 'unknown' && target === current);
}

function deploymentSummary(activeDeployments) {
  const entries = Object.entries(activeDeployments || {});
  const rows = entries.length
    ? entries.map(([worker, deployment]) => {
      const versions = Array.isArray(deployment?.version_ids)
        ? deployment.version_ids.join(', ')
        : String(deployment?.version_ids || 'unknown');
      return `| \`${worker}\` | \`${deployment?.status || 'active'}\` | \`${deployment?.deployment_id || 'unknown'}\` | \`${versions || 'unknown'}\` | ${deployment?.created_on || 'unknown'} |`;
    }).join('\n')
    : '| - | not captured | not captured | not captured | not captured |';
  return `### Active Worker deployments\n\n| Worker | Status | Deployment | Traffic-bearing versions | Deployed at |\n|---|---|---|---|---|\n${rows}`;
}

function recentMergeSummary(recentMerges) {
  const rows = (Array.isArray(recentMerges) ? recentMerges : []).slice(0, 5).map((pull) => (
    `- #${pull.number} ${String(pull.title || '').replace(/\s+/g, ' ').trim()} (\`${pull.merge_commit_sha || 'unknown'}\`, ${pull.merged_at || 'unknown'})`
  ));
  return rows.length ? `### Recent merged changes on main\n\n${rows.join('\n')}` : '';
}

export function buildIssueBody({
  generatedAt,
  targetSha,
  mainSha = 'unknown',
  runUrl,
  trigger,
  lookbackMinutes = '60',
  outcomes,
  summaries = {},
  activeDeployments = {},
  recentMerges = [],
}) {
  const overall = overallOutcome(outcomes);
  const body = `${STATUS_MARKER}
# Cloudflare Observability Status

This issue is maintained automatically by the unified HP and Stationhead Cloudflare Observability workflow.

- **Overall:** ${overall}
- **Scope:** HP + Stationhead monorepo, account-wide included usage
- **Generated:** ${generatedAt}
- **Trigger:** ${trigger}
- **Workflow source commit:** \`${targetSha}\`
- **Current main SHA:** \`${mainSha}\`
- **Workflow run:** ${runUrl}
- **Telemetry and D1 insights lookback:** ${lookbackMinutes} minutes

${deploymentSummary(activeDeployments)}

${recentMergeSummary(recentMerges)}

| Gate | Outcome |
|---|---|
${renderOutcomeRows(outcomes)}
${renderSection('Public application health endpoint snapshots', summaries.publicHealth)}
${renderSection('Account-wide projected UTC daily Worker, D1, and Queue budgets', summaries.daily)}
${renderSection('Account-wide DO, Queues, R2, and KV budgets', summaries.freeTier)}
${renderSection('Budget contract', summaries.contract)}
${renderSection('Top D1 queries by rows read', summaries.d1Insights)}
${renderSection('Cloudflare metrics and live diagnostics', summaries.observability)}
${renderSection('Current-deployment telemetry policy', summaries.telemetry)}
`;
  return clipText(body, MAX_ISSUE_BODY_CHARS);
}

async function currentMainSha(request) {
  const mainRef = String(process.env.OBSERVABILITY_MAIN_REF || 'main').trim() || 'main';
  try {
    const commit = await request('GET', `/commits/${encodeURIComponent(mainRef)}`);
    return String(commit?.sha || 'unknown');
  } catch {
    return 'unknown';
  }
}

async function recentMergedPullRequests(request) {
  try {
    const pulls = await request('GET', '/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=20');
    return (Array.isArray(pulls) ? pulls : [])
      .filter((pull) => pull?.merged_at)
      .slice(0, 5)
      .map((pull) => ({
        number: pull.number,
        title: pull.title,
        merge_commit_sha: pull.merge_commit_sha,
        merged_at: pull.merged_at,
      }));
  } catch {
    return [];
  }
}

export async function publishFromEnvironment() {
  const targetSha = requiredEnv('OBSERVABILITY_TARGET_SHA');
  const runUrl = requiredEnv('OBSERVABILITY_RUN_URL');
  const request = createGitHubRequest('cloudflare-observability-status');
  const outcomes = {
    daily: process.env.DAILY_BUDGET_OUTCOME,
    freeTier: process.env.FREE_TIER_BUDGET_OUTCOME,
    contract: process.env.BUDGET_CONTRACT_OUTCOME,
    d1Insights: process.env.D1_INSIGHTS_OUTCOME,
    query: process.env.OBSERVABILITY_QUERY_OUTCOME,
    telemetry: process.env.TELEMETRY_POLICY_OUTCOME,
  };
  const [
    mainSha,
    activeDeployments,
    recentMerges,
    publicHealth,
    daily,
    freeTier,
    contract,
    d1Insights,
    observability,
    telemetry,
  ] = await Promise.all([
    currentMainSha(request),
    readOptionalJson('active-worker-deployments.json'),
    recentMergedPullRequests(request),
    readOptionalText('public-health-endpoints.md'),
    readOptionalText('daily-usage/summary.md'),
    readOptionalText('free-tier-usage/summary.md'),
    readOptionalText('observability-gate/summary.md'),
    readOptionalText('d1-insights/summary.md'),
    readOptionalText('observability-summary.md'),
    readOptionalText('telemetry-summary.md'),
  ]);
  const body = buildIssueBody({
    generatedAt: new Date().toISOString(),
    targetSha,
    mainSha,
    runUrl,
    trigger: process.env.OBSERVABILITY_TRIGGER || 'unknown',
    lookbackMinutes: process.env.LOOKBACK_MINUTES || '60',
    outcomes,
    summaries: {
      publicHealth,
      daily,
      freeTier,
      contract,
      d1Insights,
      observability,
      telemetry,
    },
    activeDeployments,
    recentMerges,
  });
  await publishCommitStatuses({
    request,
    targetSha,
    runUrl,
    outcomes,
    contexts: STATUS_CONTEXTS,
    overallDescription: 'Unified Cloudflare observability',
  });
  if (!isCurrentMainTarget(targetSha, mainSha)) {
    console.log(
      `::warning title=Skip stale observability issue::target_sha=${targetSha} current_main_sha=${mainSha}`,
    );
    return;
  }
  const issue = await upsertStatusIssue({
    request,
    title: STATUS_ISSUE_TITLE,
    marker: STATUS_MARKER,
    body,
  });
  console.log(`Published unified observability status to issue #${issue.number}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishFromEnvironment().catch((error) => {
    console.error(`::error title=Publish observability status::${String(error?.message || error).replaceAll('\n', ' ').slice(0, 1000)}`);
    process.exitCode = 1;
  });
}
