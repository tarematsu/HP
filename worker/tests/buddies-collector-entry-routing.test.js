import assert from 'node:assert/strict';
import test from 'node:test';

import collector, {
  runAlarmCoordinatedBuddiesCollectorScheduled,
  runBuddiesCollectorScheduled,
  runBuddiesCollectorScheduledWithFollowers,
} from '../src/buddies-collector-entry.js';

test('production collector keeps the compatibility scheduling wrapper', () => {
  assert.equal(collector.scheduled, runBuddiesCollectorScheduledWithFollowers);
  assert.notEqual(collector.scheduled, runAlarmCoordinatedBuddiesCollectorScheduled);
  assert.notEqual(collector.scheduled, runBuddiesCollectorScheduled);
});

test('collector schedule delegates only to the Durable Object collector', async () => {
  const waitUntil = [];
  const calls = [];
  const controller = { cron: '*/5 * * * *', scheduledTime: Date.UTC(2026, 9, 2, 15, 0) };
  const result = await runBuddiesCollectorScheduledWithFollowers(
    controller,
    {},
    { waitUntil: (promise) => waitUntil.push(promise) },
    {
      collectFollowers: async () => calls.push('followers'),
      coordinatedScheduled: async (received) => {
        calls.push(['collector', received.scheduledTime]);
        return { ok: true };
      },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(waitUntil.length, 0);
  assert.deepEqual(calls, [['collector', controller.scheduledTime]]);
});
