import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateActionsRunnerHealth } from '../.github/scripts/github-actions-runner-health.mjs';
import { publisherActionsRunnerTargets } from '../.github/scripts/publish-github-actions-runner-health.mjs';

const NOW = Date.parse('2026-07-27T13:05:00.000Z');

function successfulRun(minutesAgo) {
  const created = new Date(NOW - minutesAgo * 60_000).toISOString();
  return {
    id: 1,
    run_number: 62,
    event: 'schedule',
    status: 'completed',
    conclusion: 'success',
    created_at: created,
    run_started_at: created,
    updated_at: created,
  };
}

test('publisher tolerates normal GitHub schedule delay before declaring Pages stale', () => {
  const targets = publisherActionsRunnerTargets();
  const pages = targets.find(({ workflow }) => workflow === 'run-pages-read-model-rebuild.yml');
  const runtime = targets.find(({ workflow }) => workflow === 'run-runtime-offline-maintenance.yml');

  assert.equal(pages.staleAfterMinutes, 60);
  assert.equal(runtime.staleAfterMinutes, 75);
  assert.equal(evaluateActionsRunnerHealth(pages, [successfulRun(43)], { now: NOW }).health, 'healthy');
  assert.equal(evaluateActionsRunnerHealth(pages, [successfulRun(61)], { now: NOW }).health, 'stale');
});

test('publisher target policy does not mutate caller-owned targets', () => {
  const source = [{ workflow: 'run-pages-read-model-rebuild.yml', staleAfterMinutes: 40 }];
  const result = publisherActionsRunnerTargets(source);
  assert.equal(source[0].staleAfterMinutes, 40);
  assert.equal(result[0].staleAfterMinutes, 60);
  assert.notEqual(result[0], source[0]);
});
