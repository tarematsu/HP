#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  MAX_ISSUE_BODY_CHARS,
  clipMarkdown,
  createGitHubRequest,
  findStatusIssue,
  publishCommitStatuses,
  readOptionalJson,
  readOptionalText,
  renderOutcomeRows,
  renderSection,
  requiredEnv,
  sanitizeText,
  upsertStatusIssue,
} from './observability-status-publisher.mjs';
import {
  buildObservabilityTriage,
  diagnosticSectionTitle,
  observabilityIssueOverall,
  publicHealthSignal,
} from './observability-issue-triage.mjs';
import { renderDailyD1SnapshotPace } from './observability-daily-trend.mjs';
import {
  extractActionsRunnerHealthBlock,
  renderActionsRunnerHealthBlock,
} from './github-actions-runner-health.mjs';
import {
  extractDeploymentHealthBlock,
  renderDeploymentHealthBlock,
} from './github-deployment-health.mjs';

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

const DIAGNOSTIC_SECTION_LIMITS = Object.freeze({
  publicHealth: 5_000,
  daily: 3_500,
  freeTier: 3_500,
  contract: 2_000,
  d1Insights: 7_000,
  observability: 6_500,
  telemetry: 6_500,
});

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
      return `| \`${worker}\` | \`${deployment?.status || 'unknown'}\` | \`${deployment?.deployment_id || 'unknown'}\` | \`${versions || 'unknown'}\` | ${deployment?.created_on || 'unknown'} |`;
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

function deploymentAndChangeContext(activeDeployments, recentMerges) {
  const content = [deploymentSummary(activeDeployments), recentMergeSummary(recentMerges)]
    .filter(Boolean)
    .join('\n\n');
  return `<a id="deployment-context" name="deployment-context"></a>\n## Deployment and change context\n\n<details>\n<summary>Active deployments and recent main changes</summary>\n\n${content}\n\n</details>`;
}

function diagnosticSection(id, title, body, state, maximum) {
  if (!body) return '';
  const bounded = clipMarkdown(body, maximum);
  return `<a id="${id}" name="${id}"></a>${renderSection(diagnosticSectionTitle(title, state), bounded)}`;
}

function pendingRunnerHealthBlock() {
  return renderActionsRunnerHealthBlock(`### GitHub Actions runner health

- **Overall:** pending
- Scheduled-run health is refreshed by the lightweight runner diagnostics workflow.`);
}

function pendingDeploymentHealthBlock() {
  return renderDeploymentHealthBlock(`### GitHub deployment health

- **Overall:** pending
- Pages and Worker deployment health is refreshed by the lightweight deployment diagnostics workflow.`);
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
  actionsRunnerHealthBlock = '',
  deploymentHealthBlock = '',
  previousIssueBody = '',
}) {
  const dailySnapshotPace = renderDailyD1SnapshotPace({
    currentSummary: summaries.daily,
    previousIssueBody,
    generatedAt,
  });
  const renderedSummaries = {
    ...summaries,
    daily: [summaries.daily, dailySnapshotPace].filter(Boolean).join('\n\n'),
  };
  const cloudflareStatus = observabilityIssueOverall({
    outcomes,
    summaries: renderedSummaries,
    activeDeployments,
    previousIssueBody,
    generatedAt,
  });
  const publicHealth = publicHealthSignal(renderedSummaries.publicHealth);
  const runnerHealth = actionsRunnerHealthBlock || pendingRunnerHealthBlock();
  const deploymentHealth = deploymentHealthBlock || pendingDeploymentHealthBlock();
  const triage = buildObservabilityTriage({
    outcomes,
    summaries: renderedSummaries,
    activeDeployments,
    runUrl,
    previousIssueBody,
    generatedAt,
  });
  const body = `${STATUS_MARKER}
# Cloudflare Observability Status

This issue is maintained automatically by the unified HP and Stationhead Cloudflare Observability workflow.

- **Cloudflare status:** ${cloudflareStatus} · **Generated:** ${generatedAt} · **Lookback:** ${lookbackMinutes} minutes · **Trigger:** ${trigger}
- **Scope:** HP + Stationhead monorepo, account-wide included usage
- **Workflow run:** ${runUrl} · **Workflow source commit:** \`${targetSha}\` · **Current main SHA:** \`${mainSha}\`

${runnerHealth}

${deploymentHealth}

${triage}

<details>
<summary>Raw gate outcomes</summary>

| Gate | Outcome |
|---|---|
${renderOutcomeRows(outcomes)}

</details>

${deploymentAndChangeContext(activeDeployments, recentMerges)}

## Detailed diagnostics
${diagnosticSection('diagnostic-public-health', 'Public application health endpoint snapshots', renderedSummaries.publicHealth, publicHealth.state, DIAGNOSTIC_SECTION_LIMITS.publicHealth)}
${diagnosticSection('diagnostic-daily', 'Account-wide projected UTC daily Worker, D1, and Queue budgets', renderedSummaries.daily, outcomes.daily, DIAGNOSTIC_SECTION_LIMITS.daily)}
${diagnosticSection('diagnostic-free-tier', 'Account-wide DO, Queues, R2, and KV budgets', renderedSummaries.freeTier, outcomes.freeTier, DIAGNOSTIC_SECTION_LIMITS.freeTier)}
${diagnosticSection('diagnostic-contract', 'Budget contract', renderedSummaries.contract, outcomes.contract, DIAGNOSTIC_SECTION_LIMITS.contract)}
${diagnosticSection('diagnostic-d1', 'Top D1 queries by rows read', renderedSummaries.d1Insights, outcomes.d1Insights, DIAGNOSTIC_SECTION_LIMITS.d1Insights)}
${diagnosticSection('diagnostic-observability', 'Cloudflare metrics and live diagnostics', renderedSummaries.observability, outcomes.query, DIAGNOSTIC_SECTION_LIMITS.observability)}
${diagnosticSection('diagnostic-telemetry', 'Current-deployment telemetry policy', renderedSummaries.telemetry, outcomes.telemetry, DIAGNOSTIC_SECTION_LIMITS.telemetry)}
`;
  const safeBody = sanitizeText(body).trim();
  if (safeBody.length > MAX_ISSUE_BODY_CHARS) {
    throw new Error(`Observability issue body exceeds ${MAX_ISSUE_BODY_CHARS} characters after bounded rendering`);
  }
  return safeBody;
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
  await publishCommitStatuses({
    request,
    targetSha,
    runUrl,
    outcomes,
    contexts: STATUS_CONTEXTS,
    overallDescription: 'Unified Cloudflare observability',
  });
  if (!isCurrentMainTarget(targetSha, mainSha)) {
    console.log(`::warning title=Skip stale observability issue::target_sha=${targetSha} current_main_sha=${mainSha}`);
    return;
  }

  const existingIssue = await findStatusIssue({ request, title: STATUS_ISSUE_TITLE, marker: STATUS_MARKER });
  const body = buildIssueBody({
    generatedAt: new Date().toISOString(),
    targetSha,
    mainSha,
    runUrl,
    trigger: process.env.OBSERVABILITY_TRIGGER || 'unknown',
    lookbackMinutes: process.env.LOOKBACK_MINUTES || '60',
    outcomes,
    summaries: { publicHealth, daily, freeTier, contract, d1Insights, observability, telemetry },
    activeDeployments,
    recentMerges,
    actionsRunnerHealthBlock: extractActionsRunnerHealthBlock(existingIssue?.body),
    deploymentHealthBlock: extractDeploymentHealthBlock(existingIssue?.body),
    previousIssueBody: existingIssue?.body,
  });
  const issue = await upsertStatusIssue({
    request,
    title: STATUS_ISSUE_TITLE,
    marker: STATUS_MARKER,
    body,
    existingIssue,
  });
  console.log(`Published unified observability status to issue #${issue.number}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishFromEnvironment().catch((error) => {
    console.error(`::error title=Publish observability status::${String(error?.message || error).replaceAll('\n', ' ').slice(0, 1000)}`);
    process.exitCode = 1;
  });
}
