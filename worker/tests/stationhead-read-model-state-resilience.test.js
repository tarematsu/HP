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

for (const reader of ['json', 'text']) {
  test(`Stationhead hot-state ${reader} body failures do not trigger fallback or bootstrap`, async () => {
    let calls = 0;
    const bucket = { async get() {
      calls += 1;
      return { async [reader]() { throw new Error('R2 body stream interrupted'); } };
    } };
    await assert.rejects(
      loadStationheadReadModelState(bucket, { source: 'ohisama' }),
      /R2 body stream interrupted/,
    );
    assert.equal(calls, 1);
  });
}

test('invalid hot-state JSON still permits public-model fallback', async () => {
  let calls = 0;
  const bucket = { async get() {
    calls += 1;
    return calls === 1 ? { async text() { return '{invalid'; } } : null;
  } };
  assert.deepEqual(
    await loadStationheadReadModelState(bucket, { source: 'ohisama' }),
    { payload: null, source: 'none' },
  );
  assert.equal(calls, 2);
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

for (const format of ['raw-response-v1', 'legacy-envelope']) {
  test(`Stationhead ${format} public-model body failures fail closed`, async () => {
    let calls = 0;
    const bucket = { async get() {
      calls += 1;
      if (calls === 1) return null;
      return {
        body: new ReadableStream({ start(controller) {
          controller.error(new Error('public-model body stream interrupted'));
        } }),
        customMetadata: format === 'raw-response-v1'
          ? { format, updated_at: String(Date.now()), status: '200' } : {},
        async json() { throw new Error('public-model body stream interrupted'); },
      };
    } };
    await assert.rejects(
      loadStationheadReadModelState(bucket, { source: 'ohisama' }),
      /public-model body stream interrupted/,
    );
    assert.equal(calls, 2);
  });
}
