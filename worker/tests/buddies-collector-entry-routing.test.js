import assert from 'node:assert/strict';
import test from 'node:test';

import collector, {
  runAlarmCoordinatedBuddiesCollectorScheduled,
  runBuddiesCollectorScheduled,
  runBuddiesCollectorScheduledWithPagesWatchdog,
} from '../src/buddies-collector-entry.js';

test('production collector Cron keeps Durable Object collection behind the Pages watchdog wrapper', () => {
  assert.equal(collector.scheduled, runBuddiesCollectorScheduledWithPagesWatchdog);
  assert.notEqual(collector.scheduled, runAlarmCoordinatedBuddiesCollectorScheduled);
  assert.notEqual(collector.scheduled, runBuddiesCollectorScheduled);
});

test('Pages watchdog is waitUntil work and does not replace coordinated collection', async () => {
  const waitUntil = [];
  const calls = [];
  const controller = { cron: '* * * * *', scheduledTime: Date.UTC(2026, 8, 22, 1, 0) };
  const result = await runBuddiesCollectorScheduledWithPagesWatchdog(
    controller,
    {},
    { waitUntil: (promise) => waitUntil.push(promise) },
    {
      watchdog: async (_env, options) => {
        calls.push(['watchdog', options.scheduledAt]);
        return { status: 'fresh' };
      },
      collectFollowers: async () => {
        calls.push(['followers']);
      },
      coordinatedScheduled: async (received) => {
        calls.push(['collector', received.scheduledTime]);
        return { ok: true };
      },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(waitUntil.length, 1);
  await Promise.all(waitUntil);
  assert.deepEqual(calls, [
    ['collector', controller.scheduledTime],
    ['watchdog', controller.scheduledTime],
  ]);
});

test('JST midnight adds one follower snapshot as independent waitUntil work', async () => {
  const waitUntil = [];
  const calls = [];
  const controller = { cron: '* * * * *', scheduledTime: Date.UTC(2026, 8, 30, 15, 0) };
  const result = await runBuddiesCollectorScheduledWithPagesWatchdog(
    controller,
    { marker: true },
    { waitUntil: (promise) => waitUntil.push(promise) },
    {
      watchdog: async () => {
        calls.push('watchdog');
      },
      collectFollowers: async (env, scheduledAt) => {
        assert.equal(env.marker, true);
        assert.equal(scheduledAt, controller.scheduledTime);
        calls.push('followers');
        return { observed_date_jst: '2026-10-01' };
      },
      coordinatedScheduled: async () => {
        calls.push('collector');
        return { ok: true };
      },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(waitUntil.length, 2);
  await Promise.all(waitUntil);
  assert.deepEqual(calls, ['collector', 'watchdog', 'followers']);
});
