import assert from 'node:assert/strict';
import test from 'node:test';

import { publishRecentDailySummariesFromWorker } from '../src/worker-daily-summary-publication.js';

const NOW = Date.UTC(2026, 9, 13, 0, 46);

test('missing D1 bindings fail closed without attempting publication', async () => {
  const result = await publishRecentDailySummariesFromWorker({}, NOW, {
    publish: async () => { throw new Error('must not publish'); },
  });
  assert.deepEqual(result, {
    skipped: true,
    reason: 'db-binding-missing',
    published: [],
    unavailable: [],
  });
});

test('concurrent invocations share one bounded publication', async () => {
  let release;
  let calls = 0;
  const minuteDb = { prepare() {} };
  const otherDb = { prepare() {} };
  const publish = async (...args) => {
    calls += 1;
    assert.deepEqual(args, [minuteDb, otherDb, NOW, 7]);
    return new Promise((resolve) => { release = resolve; });
  };

  const first = publishRecentDailySummariesFromWorker({ MINUTE_DB: minuteDb, OTHER_DB: otherDb }, NOW, { publish });
  const second = publishRecentDailySummariesFromWorker({ MINUTE_DB: minuteDb, OTHER_DB: otherDb }, NOW, { publish });
  await Promise.resolve();
  assert.equal(calls, 1);
  release({ published: ['2026-10-12'], unavailable: [] });
  assert.deepEqual(await first, { published: ['2026-10-12'], unavailable: [] });
  assert.deepEqual(await second, { published: ['2026-10-12'], unavailable: [] });
});
