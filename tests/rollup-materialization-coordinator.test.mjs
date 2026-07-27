import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { shouldThrottleRollupMaintenance } from '../worker/src/rollup-maintenance-coordinator.js';

const coordinator = readFileSync(new URL('../worker/src/rollup-maintenance-coordinator.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../database/buddies-migrations/012_rollup_materialization_state.sql', import.meta.url), 'utf8');
const actions = readFileSync(new URL('../worker/scripts/run-runtime-offline-maintenance-actions.mjs', import.meta.url), 'utf8');

test('rollup maintenance uses an expiring single-run lease', () => {
  assert.match(coordinator, /lease_until<=\?5/);
  assert.match(coordinator, /rollup-maintenance-lease-held/);
  assert.match(coordinator, /releaseRunLease/);
});

test('successful rollup runs are throttled to one execution per hour', () => {
  const state = { status: 'idle', last_error: null, updated_at: 1_000 };
  assert.equal(shouldThrottleRollupMaintenance(state, 60_999, 60_000), true);
  assert.equal(shouldThrottleRollupMaintenance(state, 61_000, 60_000), false);
  assert.equal(shouldThrottleRollupMaintenance({ ...state, status: 'running' }, 60_999, 60_000), false);
  assert.equal(shouldThrottleRollupMaintenance({ ...state, last_error: 'failed' }, 60_999, 60_000), false);
  assert.match(coordinator, /DEFAULT_RUN_INTERVAL_MS = 60 \* 60_000/);
  assert.match(coordinator, /rollup-maintenance-cadence/);
});

test('period state is normalized and daily publication failures restore dirty state', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS sh_rollup_materialization_state/);
  assert.match(migration, /PRIMARY KEY\(period_type, period_key\)/);
  assert.match(coordinator, /dailyPublished/);
  assert.match(coordinator, /dirty:/);
  assert.match(coordinator, /next_attempt_at/);
  assert.match(coordinator, /quarantined/);
});

test('runtime maintenance routes rollups through the coordinator', () => {
  assert.match(actions, /rollup-maintenance-coordinator\.js/);
  assert.doesNotMatch(actions, /from '\.\.\/src\/rollup-maintenance\.js'/);
});
