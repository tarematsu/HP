import assert from 'node:assert/strict';
import test from 'node:test';

import {
  flushPendingMinuteFactOutbox,
  resetMinuteFactHandoffCacheForTests,
} from '../src/collector-minute-fact-handoff.js';

function env() {
  return {
    DB: { prepare() {} },
    MINUTE_FACT_QUEUE: { async send() {} },
    MINUTE_FACT_OUTBOX_RECONCILE_MS: 3_600_000,
  };
}

test('healthy outbox state suppresses repeated D1 scans until reconciliation', async () => {
  const active = env();
  let now = 1_000_000;
  let scans = 0;
  const dependencies = {
    now: () => now,
    async flushResilient() {
      scans += 1;
      return { sent: 0, failed: 0, pending: false, current_sent: false };
    },
  };

  const first = await flushPendingMinuteFactOutbox(active, {}, dependencies);
  const second = await flushPendingMinuteFactOutbox(active, {}, dependencies);
  now += 3_600_000;
  const reconciled = await flushPendingMinuteFactOutbox(active, {}, dependencies);

  assert.equal(first.cache_hit, false);
  assert.equal(second.cache_hit, true);
  assert.equal(reconciled.cache_hit, false);
  assert.equal(scans, 2);
  resetMinuteFactHandoffCacheForTests(active);
});

test('known outbox backlog honors retry delay without another D1 scan', async () => {
  const active = env();
  let now = 2_000_000;
  let scans = 0;
  const dependencies = {
    now: () => now,
    async flushResilient() {
      scans += 1;
      return {
        sent: 0,
        failed: 1,
        pending: true,
        current_sent: false,
        backoff_ms: 300_000,
      };
    },
  };

  const first = await flushPendingMinuteFactOutbox(active, {}, dependencies);
  now += 60_000;
  const delayed = await flushPendingMinuteFactOutbox(active, {}, dependencies);

  assert.equal(first.pending, true);
  assert.equal(delayed.pending, true);
  assert.equal(delayed.cache_hit, true);
  assert.equal(delayed.backoff_ms, 240_000);
  assert.equal(scans, 1);
  resetMinuteFactHandoffCacheForTests(active);
});
