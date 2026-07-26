import assert from 'node:assert/strict';
import test from 'node:test';

import { BuddiesCollectorCoordinator } from '../src/buddies-collector-entry.js';

function storage() {
  const values = new Map();
  return {
    values,
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
  };
}

test('Collector Durable Object persists a last-success marker for cross-Worker gates', async () => {
  const durableStorage = storage();
  const coordinator = new BuddiesCollectorCoordinator(
    { storage: durableStorage },
    {},
    {
      now: () => 120_500,
      direct: {
        async collectRawChannel() { return { payload_bytes: 1 }; },
      },
    },
  );

  await coordinator.runMinute({ scheduledTime: 120_000 });
  assert.deepEqual(durableStorage.values.get('collector:last-success'), {
    minute_at: 120_000,
    completed_at: 120_500,
    scheduled_at: 120_000,
  });
  assert.deepEqual(await coordinator.status({
    scheduledTime: 120_000,
    minimumSuccessAt: 120_000,
    waitMs: 0,
  }), {
    ready: true,
    target_minute: 120_000,
    minimum_success_at: 120_000,
    last_success_at: 120_000,
    minute_at: 120_000,
    status: 'completed',
  });
});

test('Collector status request waits inside one Durable Object invocation', async () => {
  const durableStorage = storage();
  durableStorage.values.set('collector:minute-state', {
    minute_at: 180_000,
    status: 'running',
    started_at: 180_001,
  });
  let now = 180_001;
  let sleeps = 0;
  const coordinator = new BuddiesCollectorCoordinator(
    { storage: durableStorage },
    {},
    {
      now: () => now,
      async sleep(ms) {
        sleeps += 1;
        now += ms;
        durableStorage.values.set('collector:last-success', {
          minute_at: 180_000,
          completed_at: now,
          scheduled_at: 180_000,
        });
      },
    },
  );

  const result = await coordinator.status({
    scheduledTime: 180_000,
    minimumSuccessAt: 180_000,
    waitMs: 1_000,
    pollMs: 250,
  });
  assert.equal(result.ready, true);
  assert.equal(result.last_success_at, 180_000);
  assert.equal(sleeps, 1);
});

test('Collector status is exposed through the existing coordinator fetch surface', async () => {
  const durableStorage = storage();
  durableStorage.values.set('collector:last-success', {
    minute_at: 240_000,
    completed_at: 240_500,
    scheduled_at: 240_000,
  });
  const coordinator = new BuddiesCollectorCoordinator(
    { storage: durableStorage },
    {},
    { now: () => 240_500 },
  );
  const response = await coordinator.fetch(new Request('https://internal/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'status',
      scheduledTime: 240_000,
      minimumSuccessAt: 240_000,
      waitMs: 0,
    }),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ready, true);
});
