#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  MAX_ISSUE_BODY_CHARS,
  clipText,
  createGitHubRequest,
} from './observability-status-publisher.mjs';
import {
  replaceObservabilityCurrentMainSha,
  resolveObservabilityMainSha,
} from './observability-issue-header.mjs';
import {
  ACTIONS_RUNNER_HEALTH_END,
  ACTIONS_RUNNER_HEALTH_START,
  ACTIONS_RUNNER_TARGETS,
  MAX_ACTIONS_HEALTH_SUMMARY_CHARS,
  collectActionsRunnerHealth,
  extractActionsRunnerHealthBlock,
  renderActionsRunnerHealthSummary,
  replaceActionsRunnerHealthSection,
} from './github-actions-runner-health-current.mjs';

const STATUS_MARKER = '<!-- cloudflare-observability-status -->';
const MAX_RUNNER_HEALTH_ISSUE_BODY_CHARS = Math.max(MAX_ISSUE_BODY_CHARS, 65_000);
const CLIPPED_TEXT_SUFFIX_CHARS = '\n\n…truncated…'.length;
const RUNNER_HEALTH_BLOCK_OVERHEAD = ACTIONS_RUNNER_HEALTH_START.length
  + ACTIONS_RUNNER_HEALTH_END.length
  + 2;

export function publisherActionsRunnerTargets(targets = ACTIONS_RUNNER_TARGETS) {
  return (Array.isArray(targets) ? targets : []).map((target) => (
    target.workflow === 'run-pages-read-model-rebuild.yml'
      ? { ...target, staleAfterMinutes: Math.max(Number(target.staleAfterMinutes) || 0, 60) }
      : { ...target }
  ));
}

export function buildActionsRunnerHealthIssueBody(issueBody, summary) {
  const baseBody = String(issueBody || '');
  const existing = extractActionsRunnerHealthBlock(baseBody);
  const fixedLength = baseBody.length - existing.length;
  const availableSummaryChars = Math.max(
    0,
    MAX_RUNNER_HEALTH_ISSUE_BODY_CHARS
      - fixedLength
      - RUNNER_HEALTH_BLOCK_OVERHEAD
      - CLIPPED_TEXT_SUFFIX_CHARS,
  );
  const clippedSummary = clipText(
    summary,
    Math.min(MAX_ACTIONS_HEALTH_SUMMARY_CHARS, availableSummaryChars),
  );
  const body = replaceActionsRunnerHealthSection(baseBody, clippedSummary);
  if (body.length > MAX_RUNNER_HEALTH_ISSUE_BODY_CHARS) {
    throw new Error(
      `Observability issue body would exceed ${MAX_RUNNER_HEALTH_ISSUE_BODY_CHARS} characters after adding runner health`,
    );
  }
  return body;
}

export async function publishActionsRunnerHealthFromEnvironment() {
  const issueNumber = Number.parseInt(process.env.ACTIONS_HEALTH_ISSUE_NUMBER || '259', 10);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error('ACTIONS_HEALTH_ISSUE_NUMBER must be a positive integer');
  }
  const request = createGitHubRequest('github-actions-runner-health');
  const now = Date.now();
  const [results, mainSha] = await Promise.all([
    collectActionsRunnerHealth(request, { now, targets: publisherActionsRunnerTargets() }),
    resolveObservabilityMainSha(request),
  ]);
  const summary = renderActionsRunnerHealthSummary(results, { now });

  // Read immediately before the write so the patch is based on the newest serialized issue body.
  const issue = await request('GET', `/issues/${issueNumber}`);
  if (issue?.pull_request || !String(issue?.body || '').includes(STATUS_MARKER)) {
    throw new Error(`Issue #${issueNumber} is not the Cloudflare observability status issue`);
  }
  const synchronizedBody = replaceObservabilityCurrentMainSha(issue.body, mainSha);
  const body = buildActionsRunnerHealthIssueBody(synchronizedBody, summary);
  await request('PATCH', `/issues/${issueNumber}`, {
    title: issue.title,
    body,
    state: 'open',
  });
  console.log(`Published GitHub Actions runner health to issue #${issueNumber}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishActionsRunnerHealthFromEnvironment().catch((error) => {
    console.error(`::error title=Publish Actions runner health::${String(error?.message || error).replaceAll('\n', ' ').slice(0, 1000)}`);
    process.exitCode = 1;
  });
}
