import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BUDDIES_COLLECTOR_CRON,
  runBuddiesCollectorScheduled,
} from '../src/buddies-collector-core.js';
import { runAlarmCoordinatedBuddiesCollectorScheduled } from '../src/buddies-collector-entry.js';

test('production Buddies Wrangler cron exactly matches runtime cron contract', () => {
  const config = JSON.parse(readFileSync(
    new URL('../wrangler.buddies-collector.jsonc', import.meta.url),
    'utf8',
  ));

  assert.deepEqual(config.triggers?.crons, [BUDDIES_COLLECTOR_CRON]);
});

test('cron contract mismatch fails loudly before direct collection can be skipped silently', async () => {
  let workStarted = false;

  await assert.rejects(
    runBuddiesCollectorScheduled({
      cron: '* * * * *',
      scheduledTime: 123,
    }, {}, {}, {
      async claimPrimaryRunLock() {
        workStarted = true;
        return true;
      },
      async collectRawChannel() {
        workStarted = true;
        return {};
      },
    }),
    /buddies collector cron mismatch: expected "\*\/5 \* \* \* \*", received "\* \* \* \* \*"/,
  );

  assert.equal(workStarted, false);
});

test('cron contract mismatch fails loudly before Durable Object routing', async () => {
  let coordinatorCalled = false;

  await assert.rejects(
    runAlarmCoordinatedBuddiesCollectorScheduled({
      cron: '* * * * *',
      scheduledTime: 123,
    }, {}, {}, {
      stub: {
        async fetch() {
          coordinatorCalled = true;
          return Response.json({ collected: true });
        },
      },
    }),
    /buddies collector cron mismatch: expected "\*\/5 \* \* \* \*", received "\* \* \* \* \*"/,
  );

  assert.equal(coordinatorCalled, false);
});
