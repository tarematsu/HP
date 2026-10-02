import assert from 'node:assert/strict';
import test from 'node:test';

import { STATIONHEAD_DAILY_FOLLOWER_HANDLES } from '../src/stationhead-daily-followers.js';
import { collectStationheadPartialFollowerRecovery } from '../src/stationhead-daily-followers-partial-recovery.js';

const OBSERVED_AT = Date.parse('2026-10-02T18:05:00.000Z');

test('partial recovery publishes successful fixed targets without creating a completion row', async () => {
  let storedBody = null;
  const failedHandle = 'sakuramankai2';
  const env = {
    PAGES_RESPONSE_R2: {
      async get() { return null; },
      async put(_key, body) { storedBody = JSON.parse(body); },
    },
  };

  const result = await collectStationheadPartialFollowerRecovery(env, OBSERVED_AT, {
    now: () => OBSERVED_AT + 123,
    loadSession: async () => ({ auth_token: 'token', device_uid: 'device' }),
    discoverTargets: async () => ({
      handles: STATIONHEAD_DAILY_FOLLOWER_HANDLES,
      source_masks: Object.fromEntries(STATIONHEAD_DAILY_FOLLOWER_HANDLES.map((handle) => [handle, 1])),
    }),
    fetchProfile: async (handle) => {
      if (handle === failedHandle) throw new Error('temporary profile failure');
      return { handle, followers: 100 };
    },
  });

  assert.equal(result.observed_date_jst, '2026-10-03');
  assert.equal(result.partial, true);
  assert.equal(result.d1_completion_rows_written, 0);
  assert.equal(result.http_requests, 4);
  assert.equal(result.http_successes, 3);
  assert.equal(result.http_failures, 1);
  assert.deepEqual(result.critical_failures, [{
    handle: failedHandle,
    error: 'temporary profile failure',
  }]);
  assert.equal(storedBody.latest_date, '2026-10-03');
  assert.equal(storedBody.rows.length, 1);
  assert.equal(storedBody.rows[0].sakuramankai, 100);
  assert.equal(storedBody.rows[0].sakurazaka46jp, 100);
  assert.equal(storedBody.rows[0].nogizaka46smej, 100);
  assert.equal(Object.hasOwn(storedBody.rows[0], failedHandle), false);
});

test('partial recovery refuses to publish an empty snapshot', async () => {
  let writes = 0;
  const env = {
    PAGES_RESPONSE_R2: {
      async get() { return null; },
      async put() { writes += 1; },
    },
  };

  await assert.rejects(
    collectStationheadPartialFollowerRecovery(env, OBSERVED_AT, {
      loadSession: async () => ({ auth_token: 'token', device_uid: 'device' }),
      discoverTargets: async () => ({ handles: STATIONHEAD_DAILY_FOLLOWER_HANDLES }),
      fetchProfile: async () => { throw new Error('all profiles unavailable'); },
    }),
    /produced no profiles/,
  );
  assert.equal(writes, 0);
});