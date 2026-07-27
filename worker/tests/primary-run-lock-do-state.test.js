import assert from 'node:assert/strict';
import test from 'node:test';

import { withCollectorDoHotState } from '../src/collector-do-hot-state.js';
import {
  claimPrimaryRunLock,
  isPrimaryRunLockActive,
  PRIMARY_RUN_LOCK_STATE,
  releasePrimaryRunLock,
} from '../src/primary-run-lock.js';

function fakeStorage() {
  const values = new Map();
  return {
    values,
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
    async delete(key) { return values.delete(key); },
  };
}

function throwingDb() {
  return {
    prepare() {
      throw new Error('D1 must not be touched when Durable Object state is available');
    },
  };
}

test('primary run lease prefers Durable Object storage and never writes D1', async () => {
  const storage = fakeStorage();
  const env = withCollectorDoHotState({ DB: throwingDb() }, storage);

  assert.equal(await claimPrimaryRunLock(env, 'run-1', 1_000), true);
  assert.equal(await claimPrimaryRunLock(env, 'run-2', 2_000), false);
  assert.equal(await isPrimaryRunLockActive(env, 2_000), true);

  const stored = storage.values.get(`collector:hot:${PRIMARY_RUN_LOCK_STATE.hot_state_key}`);
  assert.equal(stored.holder_id, 'run-1');
  assert.equal(stored.lease_until, 71_000);

  assert.equal(await releasePrimaryRunLock(env, 'run-2', 3_000), false);
  assert.equal(await releasePrimaryRunLock(env, 'run-1', 3_000), true);
  assert.equal(await isPrimaryRunLockActive(env, 3_001), false);
});

test('expired Durable Object lease can be replaced without D1 fallback', async () => {
  const storage = fakeStorage();
  const env = withCollectorDoHotState({ DB: throwingDb() }, storage);

  assert.equal(await claimPrimaryRunLock(env, 'run-1', 1_000), true);
  assert.equal(await claimPrimaryRunLock(env, 'run-2', 72_000), true);

  const stored = storage.values.get(`collector:hot:${PRIMARY_RUN_LOCK_STATE.hot_state_key}`);
  assert.equal(stored.holder_id, 'run-2');
});
