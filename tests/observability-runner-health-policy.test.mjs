import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateActionsRunnerHealth } from '../.github/scripts/github-actions-runner-health.mjs';
import {
  ACTIONS_RUNNER_TARGETS,
  RECOVERY_HEADROOM_MINUTES,
  RECOVERY_WATCHDOG_INTERVAL_MINUTES,
  RECOVERY_WORKFLOWS,
  WORKFLOW_HEALTH_BY_KEY,
} from '../.github/scripts/workflow-health-policy.mjs';

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

test('central health policy tolerates normal GitHub schedule delay before declaring Pages stale', () => {
  const pages = WORKFLOW_HEALTH_BY_KEY.pages;
  const runtime = WORKFLOW_HEALTH_BY_KEY.runtime;

  assert.equal(pages.cadenceMinutes, 30);
  assert.equal(pages.staleAfterMinutes, 75);
  assert.equal(runtime.staleAfterMinutes, 75);
  assert.equal(evaluateActionsRunnerHealth(pages, [successfulRun(60)], { now: NOW }).health, 'healthy');
  assert.equal(evaluateActionsRunnerHealth(pages, [successfulRun(76)], { now: NOW }).health, 'stale');
});

test('recovery thresholds are derived from health thresholds with watchdog headroom', () => {
  assert.equal(RECOVERY_HEADROOM_MINUTES, 30);
  assert.equal(RECOVERY_WATCHDOG_INTERVAL_MINUTES, 15);
  assert.ok(RECOVERY_HEADROOM_MINUTES > RECOVERY_WATCHDOG_INTERVAL_MINUTES);

  for (const key of ['pages', 'runtime', 'metadata', 'localMinute']) {
    const policy = WORKFLOW_HEALTH_BY_KEY[key];
    const recovery = RECOVERY_WORKFLOWS[key];
    assert.equal(
      recovery.healthStaleAfterMs - recovery.recoverAfterMs,
      RECOVERY_HEADROOM_MINUTES * 60_000,
      key,
    );
    assert.equal(recovery.file, policy.workflow, key);
  }
});

test('runner target policy is frozen, unique, and sourced from the shared policy', () => {
  assert.ok(Object.isFrozen(ACTIONS_RUNNER_TARGETS));
  assert.equal(new Set(ACTIONS_RUNNER_TARGETS.map((target) => target.workflow)).size, ACTIONS_RUNNER_TARGETS.length);
  assert.equal(
    ACTIONS_RUNNER_TARGETS.find((target) => target.workflow === WORKFLOW_HEALTH_BY_KEY.pages.workflow)?.staleAfterMinutes,
    WORKFLOW_HEALTH_BY_KEY.pages.staleAfterMinutes,
  );
});
