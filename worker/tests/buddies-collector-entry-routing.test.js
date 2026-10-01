import assert from 'node:assert/strict';
import test from 'node:test';

import collector, {
  isFollowerCatchupMinute,
  runAlarmCoordinatedBuddiesCollectorScheduled,
  runBuddiesCollectorScheduled,
  runBuddiesCollectorScheduledWithFollowers,
} from '../src/buddies-collector-entry.js';

test('production collector Cron keeps Durable Object collection behind the follower wrapper', () => {
  assert.equal(collector.scheduled, runBuddiesCollectorScheduledWithFollowers);
  assert.notEqual(collector.scheduled, runAlarmCoordinatedBuddiesCollectorScheduled);
  assert.notEqual(collector.scheduled, runBuddiesCollectorScheduled);
});

test('ordinary collector minutes do not add dashboard watchdog work', async () => {
  const waitUntil = [];
  const calls = [];
  const controller = { cron: '* * * * *', scheduledTime: Date.UTC(2026, 8, 22, 1, 0) };
  const result = await runBuddiesCollectorScheduledWithFollowers(
    controller,
    {},
    { waitUntil: (promise) => waitUntil.push(promise) },
    {
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
  assert.equal(waitUntil.length, 0);
  assert.deepEqual(calls, [['collector', controller.scheduledTime]]);
});

test('JST midnight adds one follower snapshot as independent waitUntil work', async () => {
  const waitUntil = [];
  const calls = [];
  const controller = { cron: '* * * * *', scheduledTime: Date.UTC(2026, 8, 30, 15, 0) };
  const result = await runBuddiesCollectorScheduledWithFollowers(
    controller,
    { marker: true },
    { waitUntil: (promise) => waitUntil.push(promise) },
    {
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
  assert.equal(waitUntil.length, 1);
  await Promise.all(waitUntil);
  assert.deepEqual(calls, ['collector', 'followers']);
});

test('follower catch-up checks run every five minutes except on the hour', () => {
  assert.equal(isFollowerCatchupMinute(Date.UTC(2026, 9, 1, 1, 5)), true);
  assert.equal(isFollowerCatchupMinute(Date.UTC(2026, 9, 1, 14, 55)), true);
  assert.equal(isFollowerCatchupMinute(Date.UTC(2026, 9, 1, 1, 0)), false);
  assert.equal(isFollowerCatchupMinute(Date.UTC(2026, 9, 1, 1, 3)), false);
  assert.equal(isFollowerCatchupMinute(Number.NaN), false);
});

test('same-day follower catch-up schedules follower work independently from the minute collector', async () => {
  const waitUntil = [];
  const calls = [];
  const controller = { cron: '* * * * *', scheduledTime: Date.UTC(2026, 9, 1, 2, 25) };
  const result = await runBuddiesCollectorScheduledWithFollowers(
    controller,
    {},
    { waitUntil: (promise) => waitUntil.push(promise) },
    {
      collectFollowers: async () => {
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
  assert.equal(waitUntil.length, 1);
  await Promise.all(waitUntil);
  assert.deepEqual(calls, ['collector', 'followers']);
});
