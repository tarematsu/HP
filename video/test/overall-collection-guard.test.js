import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COLLECTION_CRON,
  LEGACY_SHARED_CRON,
  runUnifiedCollection
} from '../src/collection-schedule.js';

test('overall guard stops before the second collection group', async () => {
  const events = [];
  const worker = {
    scheduled(controller, _env, ctx) {
      events.push(controller.cron);
      ctx.waitUntil(new Promise((resolve) => setTimeout(resolve, 50)));
    }
  };

  await runUnifiedCollection(worker, { cron: COLLECTION_CRON }, {}, 10);
  assert.deepEqual(events, [LEGACY_SHARED_CRON]);
});
