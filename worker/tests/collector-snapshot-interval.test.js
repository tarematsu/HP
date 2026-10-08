import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotPersistenceDue as collectorDue } from '../src/collector-config.js';
import { snapshotPersistenceDue as ingestDue } from '../src/collector-ingest.js';

test('raw collector and persistence use the same snapshot interval decision', () => {
  const cases = [
    [{}, 123_000, true],
    [{ SNAPSHOT_PERSIST_INTERVAL_MS: 300_000 }, 299_000, false],
    [{ SNAPSHOT_PERSIST_INTERVAL_MS: 300_000 }, 300_000, true],
    [{ SNAPSHOT_PERSIST_INTERVAL_MS: 300_000 }, 360_000, false],
    [{ SNAPSHOT_PERSIST_INTERVAL_MS: 0 }, 360_000, true],
    [{ SNAPSHOT_PERSIST_INTERVAL_MS: 300_000 }, Number.NaN, true],
  ];
  for (const [env, at, expected] of cases) {
    assert.equal(collectorDue(env, at), expected);
    assert.equal(ingestDue(env, at), expected);
  }
  assert.equal(collectorDue, ingestDue);
});
