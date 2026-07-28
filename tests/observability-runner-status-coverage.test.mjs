import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { evaluateActionsRunnerHealth } from '../.github/scripts/github-actions-runner-health.mjs';

const NOW = Date.parse('2026-07-28T17:00:00.000Z');
const target = {
  name: 'Deployment health publisher',
  workflow: 'publish-github-deployment-health.yml',
  cadenceMinutes: 15,
  staleAfterMinutes: 45,
  stalledAfterMinutes: 10,
};

function previousSuccess() {
  return {
    id: 10,
    run_number: 597,
    event: 'schedule',
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-07-28T16:30:00.000Z',
    run_started_at: '2026-07-28T16:30:02.000Z',
    updated_at: '2026-07-28T16:30:15.000Z',
  };
}

for (const status of ['queued', 'in_progress', 'requested', 'waiting', 'pending']) {
  test(`runner health treats ${status} as an active run`, () => {
    const current = {
      id: 11,
      run_number: 598,
      event: 'workflow_run',
      status,
      conclusion: null,
      created_at: '2026-07-28T16:59:00.000Z',
      run_started_at: status === 'in_progress' ? '2026-07-28T16:59:05.000Z' : null,
      updated_at: '2026-07-28T16:59:00.000Z',
    };
    const result = evaluateActionsRunnerHealth(target, [current, previousSuccess()], { now: NOW });
    assert.equal(result.health, 'running');
    assert.match(result.reason, new RegExp(`latest run is ${status}`));
  });
}

test('deployment publisher refreshes after operational workflows without forming a runner-publisher loop', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/publish-github-deployment-health.yml', import.meta.url),
    'utf8',
  );
  for (const name of [
    'Unified Cloudflare Observability',
    'Rebuild pages read models',
    'Run runtime offline maintenance',
    'Repair track metadata',
    'Run local minute facts rebuild',
    'Refresh Cloudflare observability',
  ]) assert.match(workflow, new RegExp(name));
  assert.doesNotMatch(workflow, /Publish GitHub Actions runner health/);
  assert.match(workflow, /cron: '7,22,37,52 \* \* \* \*'/);
});
