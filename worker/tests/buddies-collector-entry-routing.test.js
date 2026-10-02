import assert from 'node:assert/strict';
import test from 'node:test';

import collector, {
  isFollowerCatchupMinute,
  isOneTimeFollowerBackfillMinute,
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
  const controller = { cron: '*/5 * * * *', scheduledTime: Date.UTC(2026, 8, 22, 1, 5) };
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
  const controller = { cron: '*/5 * * * *', scheduledTime: Date.UTC(2026, 8, 30, 15, 0) };
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

test('follower catch-up backs off after the first thirty minutes', () => {
  const midnightJst = Date.UTC(2026, 8, 30, 15, 0);
  assert.equal(isFollowerCatchupMinute(midnightJst + 5 * 60_000), false);
  assert.equal(isFollowerCatchupMinute(midnightJst + 15 * 60_000), true);
  assert.equal(isFollowerCatchupMinute(midnightJst + 30 * 60_000), true);
  assert.equal(isFollowerCatchupMinute(midnightJst + 60 * 60_000), true);
  assert.equal(isFollowerCatchupMinute(midnightJst + 23 * 60 * 60_000), true);
  assert.equal(isFollowerCatchupMinute(midnightJst + 20 * 60_000), false);
  assert.equal(isFollowerCatchupMinute(midnightJst + 65 * 60_000), false);
  assert.equal(isFollowerCatchupMinute(Number.NaN), false);
});

test('same-day hourly follower catch-up schedules work independently from the minute collector', async () => {
  const waitUntil = [];
  const calls = [];
  const controller = { cron: '*/5 * * * *', scheduledTime: Date.UTC(2026, 9, 1, 2, 0) };
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

test('October 3 one-time backfill retries on non-hour ticks from 03:00 through 05:59 JST', () => {
  assert.equal(isOneTimeFollowerBackfillMinute(Date.UTC(2026, 9, 2, 18, 5)), true);
  assert.equal(isOneTimeFollowerBackfillMinute(Date.UTC(2026, 9, 2, 18, 0)), false);
  assert.equal(isOneTimeFollowerBackfillMinute(Date.UTC(2026, 9, 2, 20, 55)), true);
  assert.equal(isOneTimeFollowerBackfillMinute(Date.UTC(2026, 9, 2, 21, 5)), false);
  assert.equal(isOneTimeFollowerBackfillMinute(Date.UTC(2026, 9, 3, 18, 5)), false);
  assert.equal(isOneTimeFollowerBackfillMinute(Number.NaN), false);
});

test('failed daily follower collection publishes a partial recovery without completing the day', async () => {
  const waitUntil = [];
  const calls = [];
  const controller = { cron: '*/5 * * * *', scheduledTime: Date.UTC(2026, 9, 2, 18, 5) };
  const result = await runBuddiesCollectorScheduledWithFollowers(
    controller,
    {},
    { waitUntil: (promise) => waitUntil.push(promise) },
    {
      collectFollowers: async () => {
        calls.push('followers');
        throw new Error('fixed target failed');
      },
      collectPartialFollowers: async (_env, scheduledAt) => {
        assert.equal(scheduledAt, controller.scheduledTime);
        calls.push('partial');
        return {
          observed_date_jst: '2026-10-03',
          partial: true,
          d1_completion_rows_written: 0,
          http_successes: 3,
          http_failures: 1,
        };
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
  assert.deepEqual(calls, ['collector', 'followers', 'partial']);
});