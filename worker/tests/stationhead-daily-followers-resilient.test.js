import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectStationheadDailyFollowersResilient,
  ensureFreshFollowerSession,
  isJstFollowerCollectionMinute,
} from '../src/stationhead-daily-followers-resilient.js';

const MIDNIGHT_JST = Date.parse('2026-09-30T15:00:00.000Z');

function session(authToken, deviceUid, tokenExpiresAt = MIDNIGHT_JST + 7_200_000) {
  return { authToken, deviceUid, tokenExpiresAt };
}

test('daily follower collection runs at 00:00, 00:05 and 00:10 JST only', () => {
  assert.equal(isJstFollowerCollectionMinute(MIDNIGHT_JST), true);
  assert.equal(isJstFollowerCollectionMinute(MIDNIGHT_JST + 5 * 60_000), true);
  assert.equal(isJstFollowerCollectionMinute(MIDNIGHT_JST + 10 * 60_000), true);
  assert.equal(isJstFollowerCollectionMinute(MIDNIGHT_JST + 60_000), false);
  assert.equal(isJstFollowerCollectionMinute(MIDNIGHT_JST + 11 * 60_000), false);
});

test('00:05 retry is skipped when the daily row already exists', async () => {
  let collected = 0;
  const env = {
    OTHER_DB: {
      prepare(sql) {
        assert.match(sql, /FROM sh_stationhead_daily_followers_v2/);
        return {
          bind(date) {
            assert.equal(date, '2026-10-01');
            return { async first() { return { observed_date_jst: date }; } };
          },
        };
      },
    },
  };

  const result = await collectStationheadDailyFollowersResilient(
    env,
    MIDNIGHT_JST + 5 * 60_000,
    {
      fetchFn: async () => { throw new Error('should not fetch'); },
      ensureSession: async () => { throw new Error('should not authenticate'); },
      collectFollowers: async () => { collected += 1; },
    },
  );

  assert.equal(collected, 0);
  assert.equal(result.skipped, true);
  assert.equal(result.skip_reason, 'already-collected');
});

test('01:00 hourly retry is skipped when the daily row already exists', async () => {
  let collected = 0;
  const env = {
    OTHER_DB: {
      prepare(sql) {
        assert.match(sql, /FROM sh_stationhead_daily_followers_v2/);
        return {
          bind(date) {
            assert.equal(date, '2026-10-01');
            return { async first() { return { observed_date_jst: date }; } };
          },
        };
      },
    },
  };

  const result = await collectStationheadDailyFollowersResilient(
    env,
    MIDNIGHT_JST + 60 * 60_000,
    {
      fetchFn: async () => { throw new Error('should not fetch'); },
      ensureSession: async () => { throw new Error('should not authenticate'); },
      collectFollowers: async () => { collected += 1; },
    },
  );

  assert.equal(collected, 0);
  assert.equal(result.skipped, true);
  assert.equal(result.skip_reason, 'already-collected');
});

test('401/403 profile responses force one shared re-auth and retry with the new session', async () => {
  const authCalls = [];
  const requests = [];
  const oldSession = session('old-token', 'old-device');
  const newSession = session('new-token', 'new-device');
  const env = { OTHER_DB: {}, BUDDIES_DB: {}, REQUEST_TIMEOUT_MS: 8_000 };

  const result = await collectStationheadDailyFollowersResilient(env, MIDNIGHT_JST, {
    ensureSession: async ({ force }) => {
      authCalls.push(force);
      return force ? newSession : oldSession;
    },
    fetchFn: async (_url, init) => {
      const headers = new Headers(init.headers || {});
      requests.push({
        authorization: headers.get('authorization'),
        device: headers.get('sth-device-uid'),
      });
      if (requests.length === 1) return new Response('', { status: 401 });
      return Response.json({ ok: true });
    },
    collectFollowers: async (_env, _scheduledAt, dependencies) => {
      const initial = await dependencies.loadSession();
      assert.equal(initial.auth_token, 'old-token');
      const response = await dependencies.fetchFn('https://www.stationhead.com/api/account/handle/sakuramankai', {
        headers: {
          authorization: 'Bearer old-token',
          'sth-device-uid': 'old-device',
        },
      });
      assert.equal(response.status, 200);
      return { inserted: true };
    },
  });

  assert.deepEqual(authCalls, [false, true]);
  assert.deepEqual(requests, [
    { authorization: 'Bearer old-token', device: 'old-device' },
    { authorization: 'Bearer new-token', device: 'new-device' },
  ]);
  assert.equal(result.inserted, true);
});

test('failed follower attempts are persisted with request failure details', async () => {
  let failureRow = null;
  const env = {
    OTHER_DB: {
      prepare(sql) {
        assert.match(sql, /INSERT INTO sh_stationhead_daily_follower_failures/);
        return {
          bind(...values) {
            failureRow = values;
            return { async run() { return { meta: { changes: 1 } }; } };
          },
        };
      },
    },
    BUDDIES_DB: {},
  };

  await assert.rejects(
    collectStationheadDailyFollowersResilient(env, MIDNIGHT_JST, {
      now: () => MIDNIGHT_JST + 999,
      ensureSession: async () => session('token', 'device'),
      fetchFn: async () => new Response('', { status: 500 }),
      collectFollowers: async (_env, _scheduledAt, dependencies) => {
        await dependencies.fetchFn('https://www.stationhead.com/api/account/handle/sakuramankai', {
          headers: {},
        });
        throw new Error('fixed target failed');
      },
    }),
    /fixed target failed/,
  );

  assert.equal(failureRow[0], '2026-10-01');
  assert.equal(failureRow[1], MIDNIGHT_JST);
  assert.equal(failureRow[2], MIDNIGHT_JST + 999);
  assert.equal(failureRow[3], 'fixed target failed');
  assert.deepEqual(JSON.parse(failureRow[4]), [{ handle: 'sakuramankai', status: 500 }]);
});

test('near-expiry auth is refreshed under the shared auth-control lock', async () => {
  const now = MIDNIGHT_JST;
  let collectorState = {
    auth_token: 'old-token',
    device_uid: 'old-device',
    token_expires_at: now + 1_000,
  };
  let saved = null;
  const env = {
    AUTH_REFRESH_BEFORE_MS: 60_000,
    BUDDIES_DB: {
      prepare(sql) {
        if (/SELECT auth_token,device_uid,token_expires_at/.test(sql)) {
          return { bind() { return { async first() { return collectorState; } }; } };
        }
        if (/INSERT OR IGNORE INTO sh_worker_auth_control/.test(sql)) {
          return { bind() { return { async run() { return { meta: { changes: 1 } }; } }; } };
        }
        if (/SET\s+lock_until=\?/m.test(sql)) {
          return { bind() { return { async run() { return { meta: { changes: 1 } }; } }; } };
        }
        if (/INSERT INTO sh_worker_collector_state/.test(sql)) {
          return {
            bind(_id, authToken, deviceUid, tokenExpiresAt) {
              return {
                async run() {
                  saved = { authToken, deviceUid, tokenExpiresAt };
                  collectorState = {
                    auth_token: authToken,
                    device_uid: deviceUid,
                    token_expires_at: tokenExpiresAt,
                  };
                  return { meta: { changes: 1 } };
                },
              };
            },
          };
        }
        if (/last_success_at=CASE/.test(sql)) {
          return { bind() { return { async run() { return { meta: { changes: 1 } }; } }; } };
        }
        throw new Error(`unexpected SQL: ${sql}`);
      },
    },
  };

  const refreshed = await ensureFreshFollowerSession(env, {
    now: () => now,
    acquireSession: async () => session('new-token', 'new-device', now + 7_200_000),
  });

  assert.equal(refreshed.authToken, 'new-token');
  assert.deepEqual(saved, {
    authToken: 'new-token',
    deviceUid: 'new-device',
    tokenExpiresAt: now + 7_200_000,
  });
});
