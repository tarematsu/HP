#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  MAX_ISSUE_BODY_CHARS,
  clipText,
  createGitHubRequest,
} from './observability-status-publisher.mjs';
import {
  MAX_ACTIONS_HEALTH_SUMMARY_CHARS,
  collectActionsRunnerHealth,
  renderActionsRunnerHealthSummary,
  replaceActionsRunnerHealthSection,
} from './github-actions-runner-health.mjs';

const STATUS_MARKER = '<!-- cloudflare-observability-status -->';
const MAX_RUNNER_HEALTH_ISSUE_BODY_CHARS = 65_000;

export function buildActionsRunnerHealthIssueBody(issueBody, summary) {
  const clippedSummary = clipText(summary, MAX_ACTIONS_HEALTH_SUMMARY_CHARS);
  const body = replaceActionsRunnerHealthSection(issueBody, clippedSummary);
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
  const results = await collectActionsRunnerHealth(request, { now });
  const summary = renderActionsRunnerHealthSummary(results, { now });

  // Read immediately before the write so the patch is based on the newest serialized issue body.
  const issue = await request('GET', `/issues/${issueNumber}`);
  if (issue?.pull_request || !String(issue?.body || '').includes(STATUS_MARKER)) {
    throw new Error(`Issue #${issueNumber} is not the Cloudflare observability status issue`);
  }
  const body = buildActionsRunnerHealthIssueBody(issue.body, summary);
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
