const WORKFLOW_PATH = '.github/workflows/sh-observability.yml';

export function extractObservabilityRunMetadata(issueBody = '') {
  const body = String(issueBody || '');
  const runId = Number(body.match(/\\/actions\\/runs\\/(\\d+)/)?.[1] || 0);
  const mainSha = body.match(/\\*\\*Current main SHA:\\*\\* `([^`]+)`/)?.[1] || '';
  return { runId, mainSha };
}

export function shouldPublishObservabilityStatus({
  currentRunId,
  targetSha,
  existingIssueBody = '',
  workflowRuns = [],
}) {
  const currentId = Number(currentRunId);
  if (!Number.isSafeInteger(currentId) || currentId <= 0) return true;

  const existing = extractObservabilityRunMetadata(existingIssueBody);
  if (existing.mainSha === targetSha && existing.runId > currentId) return false;

  return !workflowRuns.some((run) => (
    Number(run?.id) > currentId
    && run?.path === WORKFLOW_PATH
    && run?.head_sha === targetSha
    && ['queued', 'in_progress'].includes(run?.status)
  ));
}
