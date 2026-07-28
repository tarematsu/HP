#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  MAX_ISSUE_BODY_CHARS,
  clipText,
  createGitHubRequest,
} from './observability-status-publisher.mjs';
import { replaceObservabilityCurrentMainSha } from './observability-issue-header.mjs';
import {
  MAX_DEPLOYMENT_HEALTH_SUMMARY_CHARS,
  collectDeploymentHealth,
  extractDeploymentHealthBlock,
  renderDeploymentHealthSummary,
  replaceDeploymentHealthSection,
} from './github-deployment-health-current.mjs';
import {
  MAX_NATIVE_RELEASE_SUMMARY_CHARS,
  collectNativeReleaseStatus,
  renderNativeReleaseSummary,
} from './github-release-status.mjs';

const STATUS_MARKER = '<!-- cloudflare-observability-status -->';
const MAX_DEPLOYMENT_HEALTH_ISSUE_BODY_CHARS = Math.max(MAX_ISSUE_BODY_CHARS, 65_000);

export function buildDeploymentHealthIssueBody(issueBody, deploymentSummary, releaseSummary = '') {
  const baseBody = String(issueBody || '');
  const existing = extractDeploymentHealthBlock(baseBody);
  const fixedLength = baseBody.length - existing.length;
  const markerReserve = 120;
  const available = Math.max(
    600,
    MAX_DEPLOYMENT_HEALTH_ISSUE_BODY_CHARS - fixedLength - markerReserve,
  );

  let summary;
  if (releaseSummary) {
    const releaseBudget = Math.min(
      MAX_NATIVE_RELEASE_SUMMARY_CHARS,
      Math.max(300, Math.floor(available * 0.34)),
    );
    const deploymentBudget = Math.min(
      MAX_DEPLOYMENT_HEALTH_SUMMARY_CHARS,
      Math.max(300, available - releaseBudget - 2),
    );
    const clippedDeployment = clipText(deploymentSummary, deploymentBudget);
    const remaining = Math.max(200, available - clippedDeployment.length - 2);
    const clippedRelease = clipText(
      releaseSummary,
      Math.min(MAX_NATIVE_RELEASE_SUMMARY_CHARS, remaining),
    );
    summary = `${clippedDeployment}\n\n${clippedRelease}`;
  } else {
    summary = clipText(
      deploymentSummary,
      Math.min(MAX_DEPLOYMENT_HEALTH_SUMMARY_CHARS, available),
    );
  }

  const body = replaceDeploymentHealthSection(baseBody, summary);
  if (body.length > MAX_DEPLOYMENT_HEALTH_ISSUE_BODY_CHARS) {
    throw new Error(
      `Observability issue body would exceed ${MAX_DEPLOYMENT_HEALTH_ISSUE_BODY_CHARS} characters after adding deployment and release health`,
    );
  }
  return body;
}

function unavailableReleaseStatus(error) {
  return {
    main: { sha: 'unknown', url: '', title: 'Release diagnostics unavailable' },
    required: false,
    verdict: 'diagnostics unavailable',
    run: null,
    activeRun: null,
    stages: {
      workflow: {
        result: 'unknown',
        evidence: String(error?.message || error),
      },
    },
  };
}

export async function publishDeploymentHealthFromEnvironment() {
  const issueNumber = Number.parseInt(process.env.DEPLOYMENT_HEALTH_ISSUE_NUMBER || '259', 10);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error('DEPLOYMENT_HEALTH_ISSUE_NUMBER must be a positive integer');
  }
  const request = createGitHubRequest('github-deployment-health');
  const [results, releaseStatus] = await Promise.all([
    collectDeploymentHealth(request),
    collectNativeReleaseStatus(request).catch(unavailableReleaseStatus),
  ]);
  const deploymentSummary = renderDeploymentHealthSummary(results);
  const releaseSummary = renderNativeReleaseSummary(releaseStatus);
  const issue = await request('GET', `/issues/${issueNumber}`);
  if (issue?.pull_request || !String(issue?.body || '').includes(STATUS_MARKER)) {
    throw new Error(`Issue #${issueNumber} is not the Cloudflare observability status issue`);
  }
  const synchronizedBody = replaceObservabilityCurrentMainSha(issue.body, releaseStatus?.main?.sha);
  const body = buildDeploymentHealthIssueBody(synchronizedBody, deploymentSummary, releaseSummary);
  await request('PATCH', `/issues/${issueNumber}`, {
    title: issue.title,
    body,
    state: 'open',
  });
  console.log(`Published GitHub deployment and release health to issue #${issueNumber}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishDeploymentHealthFromEnvironment().catch((error) => {
    console.error(`::error title=Publish deployment health::${String(error?.message || error).replaceAll('\n', ' ').slice(0, 1000)}`);
    process.exitCode = 1;
  });
}
