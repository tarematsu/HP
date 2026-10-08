import assert from 'node:assert/strict';
import test from 'node:test';

import {
  stationheadCheckpoint,
  stationheadOperationalError,
  stationheadOperationalHealth,
} from '../../packages/sh-shared/stationhead-operational-state.mjs';

test('Stationhead operational state normalizes source checkpoint and error fields', () => {
  const checkpoint = stationheadCheckpoint({
    source: 'nogizaka46smej',
    kind: 'raw-materializer',
    at: 123,
    status: 'ok',
  });
  const error = stationheadOperationalError({ message: 'upstream failed' }, {
    source: 'ohisama',
    code: 'UPSTREAM',
    stage: 'channel',
    at: 124,
  });
  assert.equal(checkpoint.schema_version, 1);
  assert.equal(checkpoint.source, 'nogizaka');
  assert.equal(error.source, 'ohisama');
  assert.equal(error.code, 'UPSTREAM');
});

test('Stationhead health exposes the same nested checkpoint/error schema for every source', () => {
  const value = stationheadOperationalHealth({
    source: 'buddies',
    ok: false,
    observedAt: 200,
    lastRunAt: 190,
    lastSuccessAt: 180,
    checkpoint: { kind: 'collector', at: 190, status: 'error' },
    error: { code: 'FAILED', stage: 'collector', message: 'failed', at: 190 },
  });
  assert.equal(value.source, 'buddies');
  assert.equal(value.status, 'error');
  assert.equal(value.checkpoint.kind, 'collector');
  assert.equal(value.error.code, 'FAILED');
});
