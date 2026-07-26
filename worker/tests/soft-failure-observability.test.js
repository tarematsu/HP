import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

import { recordMinuteFactRuntimeState } from '../src/minute-facts-runtime-state.js';
import { throwIfSoftFailure } from '../src/soft-failure.js';

test('soft failure details are redacted before becoming thrown diagnostics', () => {
  assert.throws(
    () => throwIfSoftFailure({
      result: {
        failed: true,
        error: 'request failed with Bearer secret-token-value',
      },
    }, 'Actions maintenance'),
    /Bearer \[redacted\]/,
  );
});

test('numeric failed counters remain completion metrics rather than task soft failures', () => {
  assert.doesNotThrow(() => throwIfSoftFailure({
    failed: 1,
    processed: 10,
  }, 'Actions maintenance'));
});

test('retired Worker maintenance wrappers cannot reintroduce Queue retry behavior', () => {
  for (const path of [
    '../src/minute-maintenance-optimized-entry.js',
    '../src/minute-rebuild-batched-entry.js',
    '../src/minute-rebuild-maintenance-entry.js',
  ]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), false, path);
  }
});

test('failed=true is persisted as a failed runtime heartbeat even without an error string', async () => {
  let bound = null;
  const env = {
    MINUTE_DB: {
      prepare() {
        return {
          bind(...params) {
            bound = params;
            return this;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
      },
    },
  };
  const result = await recordMinuteFactRuntimeState(
    env,
    'sync',
    { failed: true },
    { now: 2_000, startedAt: 1_000 },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'unknown failure');
  assert.equal(bound[5], 'unknown failure');
  assert.equal(bound[7], 0);
  assert.equal(bound[8], 1);
});
