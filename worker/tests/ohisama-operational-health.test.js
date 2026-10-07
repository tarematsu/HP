import assert from 'node:assert/strict';
import test from 'node:test';

import { readOhisamaCollectorHealth } from '../src/ohisama-collector-optimized.js';

class FakeR2 {
  constructor(value) { this.value = value; }
  async get() {
    const value = this.value;
    return value == null ? null : { async json() { return value; } };
  }
}

test('Ohisama health uses the shared Stationhead operational schema', async () => {
  const health = await readOhisamaCollectorHealth({
    PAGES_RESPONSE_R2: new FakeR2({
      version: 1,
      authToken: 'token',
      deviceUid: 'device',
      lastRunAt: 190,
      lastSuccessAt: 180,
      d1CheckpointAt: 170,
      lastError: null,
    }),
  }, 200);
  assert.equal(health.schema_version, 1);
  assert.equal(health.source, 'ohisama');
  assert.equal(health.status, 'ok');
  assert.equal(health.checkpoint.kind, 'collector-state');
  assert.equal(health.checkpoint.at, 170);
});

test('Ohisama collector error is exposed in the common error shape', async () => {
  const health = await readOhisamaCollectorHealth({
    PAGES_RESPONSE_R2: new FakeR2({
      version: 1,
      lastRunAt: 190,
      lastSuccessAt: 180,
      d1CheckpointAt: 170,
      lastError: 'upstream failed',
    }),
  }, 200);
  assert.equal(health.status, 'error');
  assert.equal(health.error.code, 'COLLECTOR_ERROR');
  assert.equal(health.error.stage, 'collector');
});
