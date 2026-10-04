import assert from 'node:assert/strict';
import test from 'node:test';

import { collectActionsRunnerHealth } from '../.github/scripts/github-actions-runner-health-current.mjs';

const NOW = Date.parse('2026-10-04T14:40:00.000Z');
const target = {
  name: 'Deployment health publisher',
  workflow: 'publish-github-deployment-health.yml',
  cadenceMinutes: 30,
  staleAfterMinutes: 75,
  stalledAfterMinutes: 10,
  ignoreSupersededCancellations: true,
};

function run(overrides = {}) {
  return {
    id: 100,
    run_number: 20659,
    html_url: 'https://github.com/tarematsu/HP/actions/runs/100',
    event: 'workflow_run',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    created_at: '2026-10-04T14:35:00.000Z',
    run_started_at: '2026-10-04T14:35:01.000Z',
    updated_at: '2026-10-04T14:35:20.000Z',
    ...overrides,
  };
}

test('publisher health avoids the Actions branch query filter and filters returned runs to main itself', async () => {
  let requestedPath;
  const results = await collectActionsRunnerHealth(async (method, path) => {
    assert.equal(method, 'GET');
    requestedPath = path;
    return {
      workflow_runs: [
        run({
          id: 200,
          run_number: 20660,
          head_branch: 'feature/not-production',
          conclusion: 'failure',
          created_at: '2026-10-04T14:39:00.000Z',
          run_started_at: '2026-10-04T14:39:01.000Z',
          updated_at: '2026-10-04T14:39:20.000Z',
        }),
        run(),
      ],
    };
  }, {
    now: NOW,
    targets: [target],
    currentRunId: null,
  });

  assert.equal(
    requestedPath,
    '/actions/workflows/publish-github-deployment-health.yml/runs?per_page=20',
  );
  assert.equal(results[0].health, 'healthy');
  assert.equal(results[0].latest.id, 100);
  assert.equal(results[0].lastSuccess.id, 100);
});
