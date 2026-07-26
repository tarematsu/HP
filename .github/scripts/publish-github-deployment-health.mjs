#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  MAX_ISSUE_BODY_CHARS,
  clipText,
  createGitHubRequest,
} from './observability-status-publisher.mjs';
import {
  MAX_DEPLOYMENT_HEALTH_SUMMARY_CHARS,
  collectDeploymentHealth,
  extractDeploymentHealthBlock,
  renderDeploymentHealthSummary,
  replaceDeploymentHealthSection,
} from './github-deployment-health.mjs';

const STATUS_MARKER = '<!-- cloudflare-observability-status -->';
const MAX_DEPLOYMENT_HEALTH_ISSUE_BODY_CHARS = Math.max(MAX_ISSUE_BODY_CHARS, 65_000);

export function buildDeploymentHealthIssueBody(issueBody, summary) {
  const baseBody = String(issueBody || '');
  const existing = extractDeploymentHealthBlock(baseBody);
  const fixedLength = baseBody.length - existing.length;
  const markerReserve = 120;
  const available = Math.max(
    500,
    Math.min(
      MAX_DEPLOYMENT_HEALTH_SUMMARY_CHARS,
      MAX_DEPLOYMENT_HEALTH_ISSUE_BODY_CHARS - fixedLength - markerReserve,
    ),
  );
  const clippedSummary = clipText(summary, available);
  const body = replaceDeploymentHealthSection(baseBody, clippedSummary);
  if (body.length > MAX_DEPLOYMENT_HEALTH_ISSUE_BODY_CHARS) {
    throw new Error(
      `Observability issue body would exceed ${MAX_DEPLOYMENT_HEALTH_ISSUE_BODY_CHARS} characters after adding deployment health`,
    );
  }
  return body;
}

export async function publishDeploymentHealthFromEnvironment() {
  const issueNumber = Number.parseInt(process.env.DEPLOYMENT_HEALTH_ISSUE_NUMBER || '259', 10);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error('DEPLOYMENT_HEALTH_ISSUE_NUMBER must be a positive integer');
  }
  const request = createGitHubRequest('github-deployment-health');
  const results = await collectDeploymentHealth(request);
  const summary = renderDeploymentHealthSummary(results);
  const issue = await request('GET', `/issues/${issueNumber}`);
  if (issue?.pull_request || !String(issue?.body || '').includes(STATUS_MARKER)) {
    throw new Error(`Issue #${issueNumber} is not the Cloudflare observability status issue`);
  }
  const body = buildDeploymentHealthIssueBody(issue.body, summary);
  await request('PATCH', `/issues/${issueNumber}`, {
    title: issue.title,
    body,
    state: 'open',
  });
  console.log(`Published GitHub deployment health to issue #${issueNumber}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishDeploymentHealthFromEnvironment().catch((error) => {
    console.error(`::error title=Publish deployment health::${String(error?.message || error).replaceAll('\n', ' ').slice(0, 1000)}`);
    process.exitCode = 1;
  });
}
