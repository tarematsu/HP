import assert from 'node:assert/strict';
import test from 'node:test';
import { loadStationheadReadModelState } from '../src/stationhead-read-model-state.js';

test('Stationhead hot-state read failures fail closed instead of triggering D1 bootstrap', async () => {
  const bucket = { async get() { throw new Error('transient R2 outage'); } };
  await assert.rejects(
    loadStationheadReadModelState(bucket, { source: 'ohisama' }),
    /transient R2 outage/,
  );
});

test('Stationhead missing R2 binding fails closed instead of rebuilding over existing data', async () => {
  await assert.rejects(
    loadStationheadReadModelState({}, { source: 'ohisama' }),
    /R2 binding is missing/,
  );
});

test('Stationhead public-model read failures fail closed after missing hot state', async () => {
  let calls = 0;
  const bucket = { async get() {
    calls += 1;
    if (calls === 1) return null;
    throw new Error('public-model R2 outage');
  } };
  await assert.rejects(
    loadStationheadReadModelState(bucket, { source: 'ohisama' }),
    /public-model R2 outage/,
  );
  assert.equal(calls, 2);
});

test('genuinely absent Stationhead models still allow initial bootstrap', async () => {
  let calls = 0;
  const bucket = { async get() { calls += 1; return null; } };
  assert.deepEqual(
    await loadStationheadReadModelState(bucket, { source: 'ohisama' }),
    { payload: null, source: 'none' },
  );
  assert.equal(calls, 2);
});
