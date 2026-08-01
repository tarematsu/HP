import assert from 'node:assert/strict';
import test from 'node:test';

import { readOtherHealth } from '../functions/lib/health-other.js';

const NOW = 1_700_000_000_000;

function statusDb(status, overrides = {}) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM sh_collector_status/);
      return {
        bind(collectorId) {
          assert.equal(collectorId, 'other-cron');
          return this;
        },
        async first() {
          return {
            status,
            last_attempt_at: NOW - 60_000,
            last_success_at: NOW - 30 * 60_000,
            last_error: null,
            ...overrides,
          };
        },
      };
    },
  };
}

test('runtime health stays available while maintenance is actively running', async () => {
  const health = await readOtherHealth({ OTHER_DB: statusDb('running') }, NOW);
  assert.equal(health.ok, true);
  assert.equal(health.stale, false);
  assert.equal(health.status, 'running');
});

test('runtime public health remains available after the runner warning threshold', async () => {
  const health = await readOtherHealth({
    OTHER_DB: statusDb('ok', { last_attempt_at: NOW - 76 * 60_000 }),
    OTHER_CRON_STALE_MS: 90 * 60_000,
  }, NOW);
  assert.equal(health.ok, true);
  assert.equal(health.stale, false);
  assert.equal(health.stale_after_ms, 90 * 60_000);
});

test('runtime health becomes stale after the public availability grace period', async () => {
  const health = await readOtherHealth({
    OTHER_DB: statusDb('ok', { last_attempt_at: NOW - 91 * 60_000 }),
    OTHER_CRON_STALE_MS: 90 * 60_000,
  }, NOW);
  assert.equal(health.ok, false);
  assert.equal(health.stale, true);
});

test('runtime health still fails for explicit maintenance errors', async () => {
  const health = await readOtherHealth({
    OTHER_DB: statusDb('error', { last_error: 'retention failed' }),
  }, NOW);
  assert.equal(health.ok, false);
  assert.equal(health.stale, false);
  assert.equal(health.last_error_present, true);
});
