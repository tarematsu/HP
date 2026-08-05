import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectActionsRunnerHealth,
  filterCurrentRunnerPublisherRuns,
} from '../.github/scripts/github-actions-runner-health-current.mjs';

const NOW = Date.parse('2026-08-01T00:10:00.000Z');
const target = {
  name: 'Runner health publisher',
  workflow: 'publish-github-actions-runner-health.yml',
  cadenceMinutes: 15,
  staleAfterMinutes: 45,
  stalledAfterMinutes: 10,
};

function run(overrides = {}) {
  return {
    id: 100,
    run_number: 1700,
    html_url: 'https://github.com/tarematsu/HP/actions/runs/100',
    event: 'schedule',
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-08-01T00:00:00.000Z',
    run_started_at: '2026-08-01T00:00:05.000Z',
    updated_at: '2026-08-01T00:00:50.000Z',
    ...overrides,
  };
}

test('runner publisher self-health excludes the current run and superseded cancellations', () => {
  const filtered = filterCurrentRunnerPublisherRuns([
    run({
      id: 103,
      run_number: 1703,
      status: 'in_progress',
      conclusion: null,
      created_at: '2026-08-01T00:09:00.000Z',
      run_started_at: '2026-08-01T00:09:05.000Z',
      updated_at: null,
    }),
    run({
      id: 102,
      run_number: 1702,
      conclusion: 'cancelled',
      created_at: '2026-08-01T00:08:00.000Z',
      run_started_at: '2026-08-01T00:08:05.000Z',
      updated_at: '2026-08-01T00:09:00.000Z',
    }),
    run({ id: 101, run_number: 1701 }),
  ], { currentRunId: '103' });

  assert.deepEqual(filtered.map((entry) => entry.id), [101]);
});

test('publisher filtering treats any later run as the replacement for a cancelled run', () => {
  const filtered = filterCurrentRunnerPublisherRuns([
    run({
      id: 103,
      run_number: 1703,
      status: 'in_progress',
      conclusion: null,
      created_at: '2026-08-01T00:09:30.000Z',
      run_started_at: '2026-08-01T00:09:35.000Z',
      updated_at: null,
    }),
    run({
      id: 102,
      run_number: 1702,
      conclusion: 'cancelled',
      created_at: '2026-08-01T00:08:00.000Z',
      run_started_at: '2026-08-01T00:08:05.000Z',
      updated_at: '2026-08-01T00:09:00.000Z',
    }),
    run({ id: 101, run_number: 1701 }),
  ], {
    currentRunId: '103',
    ignoreReplacementTiming: true,
  });

  assert.deepEqual(filtered.map((entry) => entry.id), [101]);
});

test('runner publisher reports the latest completed success instead of its active self-run', async () => {
  const results = await collectActionsRunnerHealth(async (method, path) => {
    assert.equal(method, 'GET');
    assert.match(path, /publish-github-actions-runner-health\.yml/);
    return {
      workflow_runs: [
        run({
          id: 103,
          run_number: 1703,
          status: 'in_progress',
          conclusion: null,
          created_at: '2026-08-01T00:09:00.000Z',
          run_started_at: '2026-08-01T00:09:05.000Z',
          updated_at: null,
        }),
        run({
          id: 102,
          run_number: 1702,
          conclusion: 'cancelled',
          created_at: '2026-08-01T00:08:00.000Z',
          run_started_at: '2026-08-01T00:08:05.000Z',
          updated_at: '2026-08-01T00:09:00.000Z',
        }),
        run({ id: 101, run_number: 1701 }),
      ],
    };
  }, {
    now: NOW,
    targets: [target],
    currentRunId: '103',
  });

  assert.equal(results[0].health, 'healthy');
  assert.equal(results[0].latest.id, 101);
  assert.equal(results[0].consecutiveFailures, 0);
});

test('deployment publisher ignores a cancelled run once a replacement exists', async () => {
  const deploymentTarget = {
    name: 'Deployment health publisher',
    workflow: 'publish-github-deployment-health.yml',
    cadenceMinutes: 15,
    staleAfterMinutes: 45,
    stalledAfterMinutes: 10,
    ignoreSupersededCancellations: true,
  };
  const results = await collectActionsRunnerHealth(async (method, path) => {
    assert.equal(method, 'GET');
    assert.match(path, /publish-github-deployment-health\.yml/);
    return {
      workflow_runs: [
        run({
          id: 103,
          run_number: 1703,
          status: 'in_progress',
          conclusion: null,
          created_at: '2026-08-01T00:09:30.000Z',
          run_started_at: '2026-08-01T00:09:35.000Z',
          updated_at: null,
        }),
        run({
          id: 102,
          run_number: 1702,
          conclusion: 'cancelled',
          created_at: '2026-08-01T00:08:00.000Z',
          run_started_at: '2026-08-01T00:08:05.000Z',
          updated_at: '2026-08-01T00:09:00.000Z',
        }),
        run({ id: 101, run_number: 1701 }),
      ],
    };
  }, {
    now: NOW,
    targets: [deploymentTarget],
    currentRunId: null,
  });

  assert.equal(results[0].health, 'running');
  assert.equal(results[0].latest.id, 103);
  assert.equal(results[0].consecutiveFailures, 0);
});

test('an unsuperseded latest cancellation remains a failure', () => {
  const filtered = filterCurrentRunnerPublisherRuns([
    run({
      id: 102,
      run_number: 1702,
      conclusion: 'cancelled',
      created_at: '2026-08-01T00:08:00.000Z',
      run_started_at: '2026-08-01T00:08:05.000Z',
      updated_at: '2026-08-01T00:09:00.000Z',
    }),
    run({ id: 101, run_number: 1701 }),
  ], { currentRunId: null });

  assert.deepEqual(filtered.map((entry) => entry.id), [102, 101]);
});

test('a cancellation completed before a later run was created remains a consecutive failure by default', async () => {
  const results = await collectActionsRunnerHealth(async () => ({
    workflow_runs: [
      run({
        id: 103,
        run_number: 1703,
        conclusion: 'failure',
        created_at: '2026-08-01T00:08:00.000Z',
        run_started_at: '2026-08-01T00:08:05.000Z',
        updated_at: '2026-08-01T00:09:00.000Z',
      }),
      run({
        id: 102,
        run_number: 1702,
        conclusion: 'cancelled',
        created_at: '2026-08-01T00:01:00.000Z',
        run_started_at: '2026-08-01T00:01:05.000Z',
        updated_at: '2026-08-01T00:02:00.000Z',
      }),
      run({
        id: 101,
        run_number: 1701,
        created_at: '2026-07-31T23:45:00.000Z',
        run_started_at: '2026-07-31T23:45:05.000Z',
        updated_at: '2026-07-31T23:45:50.000Z',
      }),
    ],
  }), {
    now: NOW,
    targets: [target],
    currentRunId: null,
  });

  assert.equal(results[0].health, 'failure');
  assert.equal(results[0].latest.id, 103);
  assert.equal(results[0].consecutiveFailures, 2);
});
