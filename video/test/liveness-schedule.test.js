import assert from 'node:assert/strict';
import test from 'node:test';

import { LIVENESS_BATCH_SIZE } from '../src/liveness-monitor.js';
import { LIVENESS_CRON } from '../src/liveness-schedule.js';

test('liveness preserves 120 daily probes as one probe per invocation', () => {
  assert.equal(LIVENESS_CRON, '*/12 * * * *');
  assert.equal(LIVENESS_BATCH_SIZE, 1);
  assert.equal((24 * 60) / 12 * LIVENESS_BATCH_SIZE, 120);
});
