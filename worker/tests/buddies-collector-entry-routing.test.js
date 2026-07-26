import assert from 'node:assert/strict';
import test from 'node:test';

import collector, {
  runAlarmCoordinatedBuddiesCollectorScheduled,
  runBuddiesCollectorScheduled,
} from '../src/buddies-collector-entry.js';

test('production collector Cron delegates to the Durable Object coordinator', () => {
  assert.equal(collector.scheduled, runAlarmCoordinatedBuddiesCollectorScheduled);
  assert.notEqual(collector.scheduled, runBuddiesCollectorScheduled);
});
