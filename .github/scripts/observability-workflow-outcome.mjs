#!/usr/bin/env node

import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import {
  createGitHubRequest,
  findStatusIssue,
  readOptionalJson,
  readOptionalText,
  requiredEnv,
} from './observability-status-publisher.mjs';
import { observabilityIssueOverall } from './observability-issue-triage.mjs';
import { publishObservabilitySystemStatusFromEnvironment } from './observability-system-status.mjs';
import {
  STATUS_ISSUE_TITLE,
  STATUS_MARKER,
  isCurrentMainTarget,
} from './publish-cloudflare-observability-status.mjs';

export function resolveObservabilityWorkflowOutcome({
  targetSha,
  mainSha,
  outcomes = {},
  summaries = {},
  activeDeployments = {},
  previousIssueBody = '',
  generatedAt = '',
}) {
  return {
    currentMainTarget: isCurrentMainTarget(targetSha, mainSha),
    overall: observabilityIssueOverall({
      outcomes,
      summaries,
      activeDeployments,
      previousIssueBody,
      generatedAt,
    }),
  };
}

export function issueBodyMatchesPublishedRun(body, { targetSha, runUrl }) {
  const text = String(body || '');
  const target = String(targetSha || '').trim();
  const url = String(runUrl || '').trim();
  return Boolean(
    target
    && url
    && text.includes(`**Workflow run:** ${url}`)
    && text.includes(`**Workflow source commit:** \`${target}\``)
  );
}

async function currentMainSha(request) {
  const mainRef = String(process.env.OBSERVABILITY_MAIN_REF || 'main').trim() || 'main';
  const commit = await request('GET', `/commits/${encodeURIComponent(mainRef)}`);
  const sha = String(commit?.sha || '').trim();
  if (!sha) throw new Error(`Could not resolve ${mainRef} SHA`);
  return sha;
}

async function writeOutput(name, value) {
  const outputPath = String(process.env.GITHUB_OUTPUT || '').trim();
  if (!outputPath) return;
  await appendFile(outputPath, `${name}=${String(value)}\n`, 'utf8');
}

export async function publishSemanticOverallStatus({ request, targetSha, runUrl, overall }) {
  const normalized = String(overall || '').trim().toLowerCase();
  if (!['success', 'failure'].includes(normalized)) {
    throw new Error(`Invalid semantic observability outcome: ${overall}`);
  }
  await request('POST', `/statuses/${encodeURIComponent(targetSha)}`, {
    state: normalized,
    context: 'observability/overall',
    description: `Unified Cloudflare observability: ${normalized}`.slice(0, 140),
    target_url: runUrl,
  });
}

export async function resolveFromEnvironment() {
  const targetSha = requiredEnv('OBSERVABILITY_TARGET_SHA');
  const request = createGitHubRequest('cloudflare-observability-workflow-outcome');
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
    existingIssue,
    activeDeployments,
    publicHealth,
    daily,
    freeTier,
    contract,
    d1Insights,
    observability,
    telemetry,
  ] = await Promise.all([
    currentMainSha(request),
    findStatusIssue({ request, title: STATUS_ISSUE_TITLE, marker: STATUS_MARKER }),
    readOptionalJson('active-worker-deployments.json'),
    readOptionalText('public-health-endpoints.md'),
    readOptionalText('daily-usage/summary.md'),
    readOptionalText('free-tier-usage/summary.md'),
    readOptionalText('observability-gate/summary.md'),
    readOptionalText('d1-insights/summary.md'),
    readOptionalText('observability-summary.md'),
    readOptionalText('telemetry-summary.md'),
  ]);
  const decision = resolveObservabilityWorkflowOutcome({
    targetSha,
    mainSha,
    outcomes,
    summaries: { publicHealth, daily, freeTier, contract, d1Insights, observability, telemetry },
    activeDeployments,
    previousIssueBody: existingIssue?.body,
    generatedAt: new Date().toISOString(),
  });

  await writeOutput('current_main_target', decision.currentMainTarget);
  await writeOutput('overall', decision.overall);

  if (!decision.currentMainTarget) {
    console.log(`::warning title=Ignore stale observability outcome::target_sha=${targetSha} current_main_sha=${mainSha}`);
  }
  console.log(`OBSERVABILITY_WORKFLOW_OUTCOME overall=${decision.overall} current_main_target=${decision.currentMainTarget}`);
  return decision;
}

export async function publishOverallFromEnvironment() {
  const targetSha = requiredEnv('OBSERVABILITY_TARGET_SHA');
  const runUrl = requiredEnv('OBSERVABILITY_RUN_URL');
  const request = createGitHubRequest('cloudflare-observability-semantic-status');
  const mainSha = await currentMainSha(request);
  if (!isCurrentMainTarget(targetSha, mainSha)) {
    console.log(`::warning title=Skip stale semantic status::target_sha=${targetSha} current_main_sha=${mainSha}`);
    return false;
  }

  const issue = await findStatusIssue({ request, title: STATUS_ISSUE_TITLE, marker: STATUS_MARKER });
  if (!issueBodyMatchesPublishedRun(issue?.body, { targetSha, runUrl })) {
    throw new Error('Persistent observability Issue was not updated by this workflow run');
  }

  await publishSemanticOverallStatus({
    request,
    targetSha,
    runUrl,
    overall: requiredEnv('OBSERVABILITY_OVERALL'),
  });
  await publishObservabilitySystemStatusFromEnvironment();
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv.includes('--publish-status')
    ? publishOverallFromEnvironment
    : resolveFromEnvironment;
  command().catch((error) => {
    console.error(`::error title=Resolve observability workflow outcome::${String(error?.message || error).replaceAll('\n', ' ').slice(0, 1000)}`);
    process.exitCode = 1;
  });
}
