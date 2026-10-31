import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractObservabilityRunMetadata,
  shouldPublishObservabilityStatus,
} from '../.github/scripts/observability-run-ordering.mjs';

test('older report yields to a newer same-main observability run in progress', () => {
  assert.equal(shouldPublishObservabilityStatus({
    currentRunId: 100,
    targetSha: 'main-sha',
    workflowRuns: [{
      id: 101,
      path: '.github/workflows/sh-observability.yml',
      head_sha: 'main-sha',
      status: 'in_progress',
    }],
  }), false);
});

test('older report yields to a newer report already stored on the same main SHA', () => {
  const issueBody = '- **Workflow run:** https://github.com/tarematsu/HP/actions/runs/101 · **Current main SHA:** `main-sha`';
  assert.deepEqual(extractObservabilityRunMetadata(issueBody), { runId: 101, mainSha: 'main-sha' });
  assert.equal(shouldPublishObservabilityStatus({
    currentRunId: 100,
    targetSha: 'main-sha',
    existingIssueBody: issueBody,
  }), false);
});

test('different SHA, unrelated workflow, older run, and invalid run do not block publication', () => {
  const runs = [
    { id: 102, path: '.github/workflows/deploy-split-pipeline.yml', head_sha: 'main-sha', status: 'in_progress' },
    { id: 103, path: '.github/workflows/sh-observability.yml', head_sha: 'other-sha', status: 'in_progress' },
    { id: 99, path: '.github/workflows/sh-observability.yml', head_sha: 'main-sha', status: 'in_progress' },
    { id: 104, path: '.github/workflows/sh-observability.yml', head_sha: 'main-sha', status: 'completed' },
  ];
  assert.equal(shouldPublishObservabilityStatus({
    currentRunId: 100,
    targetSha: 'main-sha',
    workflowRuns: runs,
  }), true);
});
