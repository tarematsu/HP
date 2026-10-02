import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STATIONHEAD_DAILY_FOLLOWER_HANDLES,
  collectStationheadDailyFollowers,
  discoverStationheadFollowerTargets,
  followerProfileFromPayload,
  isJstMidnightMinute,
  jstDateKey,
} from '../src/stationhead-daily-followers.js';

const MIDNIGHT_JST = Date.parse('2026-09-30T15:00:00.000Z');

function followerPayload(handle, followers, id) {
  return { data: { account: { id, handle, followers } } };
}

function buddiesAuthDb(session, state = { reads: 0 }) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM sh_worker_collector_state WHERE id=\?/);
      return {
        bind(id) {
          assert.equal(id, 'stationhead');
          return {
            async first() {
              state.reads += 1;
              return session;
            },
          };
        },
      };
    },
  };
}

test('daily follower schedule fires only at the JST midnight minute', () => {
  assert.equal(isJstMidnightMinute(MIDNIGHT_JST), true);
  assert.equal(isJstMidnightMinute(MIDNIGHT_JST + 59_999), true);
  assert.equal(isJstMidnightMinute(MIDNIGHT_JST + 60_000), false);
  assert.equal(jstDateKey(MIDNIGHT_JST), '2026-10-01');
});

test('profile extraction requires a non-negative follower count', () => {
  for (const missing of [null, '', false]) {
    assert.throws(() => followerProfileFromPayload(followerPayload('sakuramankai', missing, 99), 'sakuramankai'), /followers missing/);
  }
  assert.deepEqual(
    followerProfileFromPayload(followerPayload('sakuramankai', 1234, 99), 'sakuramankai'),
    { handle: 'sakuramankai', account_id: 99, followers: 1234 },
  );
  assert.throws(
    () => followerProfileFromPayload({ account: { handle: 'sakuramankai' } }, 'sakuramankai'),
    /followers missing/,
  );
});

test('Buddies broadcast hosts are merged into the permanent follower target registry', async () => {
  const existingRows = STATIONHEAD_DAILY_FOLLOWER_HANDLES.map((handle) => ({ handle, source_mask: 1 }));
  existingRows.push({ handle: 'ohisamahost', source_mask: 4 });
  const writes = [];
  const env = {
    MINUTE_DB: {
      prepare(sql) {
        assert.match(sql, /FROM sh_broadcast_sessions AS s/);
        assert.match(sql, /JOIN sh_hosts AS h/);
        return { async all() { return { results: [{ handle: 'BuddyHost' }] }; } };
      },
    },
    OTHER_DB: {
      prepare(sql) {
        if (/SELECT handle,source_mask/.test(sql)) {
          return { async all() { return { results: existingRows }; } };
        }
        assert.match(sql, /INSERT INTO sh_stationhead_follower_targets/);
        return {
          bind(...values) {
            return {
              async run() {
                writes.push(values);
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };

  const result = await discoverStationheadFollowerTargets(env, MIDNIGHT_JST);
  assert.deepEqual(result.handles, [
    ...STATIONHEAD_DAILY_FOLLOWER_HANDLES,
    'buddyhost',
    'ohisamahost',
  ]);
  assert.deepEqual(writes, [['buddyhost', 2, MIDNIGHT_JST]]);
  assert.equal(result.target_writes, 1);
  assert.equal(result.buddies_discovered, 1);
});

test('target discovery keeps fixed and registered handles when minute-facts discovery fails', async () => {
  const existingRows = STATIONHEAD_DAILY_FOLLOWER_HANDLES.map((handle) => ({ handle, source_mask: 1 }));
  existingRows.push({ handle: 'ohisamahost', source_mask: 4 });
  const env = {
    MINUTE_DB: {
      prepare() {
        return { async all() { throw new Error('D1_ERROR: no such table: sh_broadcast_sessions'); } };
      },
    },
    OTHER_DB: {
      prepare(sql) {
        if (/SELECT handle,source_mask/.test(sql)) {
          return { async all() { return { results: existingRows }; } };
        }
        return { bind() { return { async run() { return { meta: { changes: 0 } }; } }; } };
      },
    },
  };

  const result = await discoverStationheadFollowerTargets(env, MIDNIGHT_JST);
  assert.deepEqual(result.handles, [...STATIONHEAD_DAILY_FOLLOWER_HANDLES, 'ohisamahost']);
  assert.equal(result.buddies_discovered, 0);
  assert.match(result.buddies_discovery_error, /no such table/);
  assert.equal(result.buddies_d1_reads, 1);
});

test('collector fetches fixed and auto-added targets while keeping one compact daily D1 row', async () => {
  const dynamicHandles = [...STATIONHEAD_DAILY_FOLLOWER_HANDLES, 'buddyhost', 'ohisamahost'];
  const counts = new Map([
    ['sakuramankai', 101],
    ['sakuramankai2', 202],
    ['sakurazaka46jp', 303],
    ['nogizaka46smej', 404],
    ['buddyhost', 505],
    ['ohisamahost', 606],
  ]);
  const requested = [];
  const authReads = { reads: 0 };
  const fetchFn = async (url, options) => {
    const handle = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    requested.push(handle);
    assert.equal(options.headers.authorization, 'Bearer buddies-token');
    assert.equal(options.headers['sth-device-uid'], 'buddies-device');
    return Response.json(followerPayload(handle, counts.get(handle), requested.length));
  };

  let bound = null;
  let r2Reads = 0;
  let r2Writes = 0;
  let storedBody = null;
  const env = {
    SH_APP_VERSION: '1.0.0',
    BUDDIES_DB: buddiesAuthDb({
      auth_token: 'buddies-token',
      device_uid: 'buddies-device',
      token_expires_at: MIDNIGHT_JST + 3_600_000,
    }, authReads),
    OTHER_DB: {
      prepare(sql) {
        assert.match(sql, /INSERT INTO sh_stationhead_daily_followers_v2/);
        return {
          bind(...values) {
            bound = values;
            return { async run() { return { meta: { changes: 1 } }; } };
          },
        };
      },
    },
    PAGES_RESPONSE_R2: {
      async get(key) {
        r2Reads += 1;
        assert.equal(key, 'pages-response/v1/followers.json');
        return null;
      },
      async put(key, body, options) {
        r2Writes += 1;
        assert.equal(key, 'pages-response/v1/followers.json');
        storedBody = JSON.parse(body);
        assert.equal(options.customMetadata.cadence_seconds, '86400');
      },
    },
  };

  const result = await collectStationheadDailyFollowers(env, MIDNIGHT_JST, {
    fetchFn,
    now: () => MIDNIGHT_JST + 321,
    discoverTargets: async () => ({
      handles: dynamicHandles,
      target_writes: 0,
      buddies_d1_reads: 1,
      other_d1_reads: 1,
    }),
  });

  assert.deepEqual(requested.sort(), [...dynamicHandles].sort());
  assert.equal(authReads.reads, 1);
  assert.equal(bound[0], '2026-10-01');
  assert.equal(bound[1], MIDNIGHT_JST);
  assert.equal(bound[2], MIDNIGHT_JST + 321);
  assert.deepEqual(JSON.parse(bound[3]), Object.fromEntries(dynamicHandles.map((handle) => [handle, counts.get(handle)])));
  assert.deepEqual(JSON.parse(bound[4]), []);
  assert.equal(r2Reads, 1);
  assert.equal(r2Writes, 1);
  assert.deepEqual(storedBody.handles, dynamicHandles);
  assert.equal(storedBody.rows[0].buddyhost, 505);
  assert.equal(storedBody.rows[0].ohisamahost, 606);
  assert.deepEqual(storedBody.accounts.at(-1), {
    handle: 'ohisamahost',
    followers: 606,
    previous_day_delta: null,
    previous_week_delta: null,
  });
  assert.equal(result.d1_rows_written, 1);
  assert.equal(result.http_requests, 6);
  assert.equal(result.http_successes, 6);
  assert.equal(result.http_failures, 0);
});

test('new auto-added host keeps older dates sparse and gets deltas only after history exists', async () => {
  const existing = {
    ok: true,
    handles: STATIONHEAD_DAILY_FOLLOWER_HANDLES,
    rows: [
      { date: '2026-09-24', sakuramankai: 90, sakuramankai2: 190, sakurazaka46jp: 290, nogizaka46smej: 390 },
      { date: '2026-09-30', sakuramankai: 100, sakuramankai2: 200, sakurazaka46jp: 300, nogizaka46smej: 400 },
    ],
  };
  let storedBody = null;
  const handles = [...STATIONHEAD_DAILY_FOLLOWER_HANDLES, 'newhost'];
  const counts = new Map([
    ['sakuramankai', 105],
    ['sakuramankai2', 207],
    ['sakurazaka46jp', 309],
    ['nogizaka46smej', 411],
    ['newhost', 12],
  ]);
  const env = {
    BUDDIES_DB: buddiesAuthDb({ auth_token: 'token', device_uid: 'device' }),
    OTHER_DB: {
      prepare() {
        return {
          bind() {
            return { async run() { return { meta: { changes: 1 } }; } };
          },
        };
      },
    },
    PAGES_RESPONSE_R2: {
      async get() {
        return { async json() { return existing; } };
      },
      async put(_key, body) {
        storedBody = JSON.parse(body);
      },
    },
  };
  const fetchFn = async (url) => {
    const handle = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    return Response.json(followerPayload(handle, counts.get(handle), 1));
  };

  await collectStationheadDailyFollowers(env, MIDNIGHT_JST, {
    fetchFn,
    now: () => MIDNIGHT_JST + 500,
    discoverTargets: async () => ({ handles, target_writes: 0 }),
  });

  assert.equal(storedBody.rows.length, 3);
  assert.equal('newhost' in storedBody.rows[0], false);
  assert.equal('newhost' in storedBody.rows[1], false);
  assert.equal(storedBody.rows[2].newhost, 12);
  assert.deepEqual(storedBody.accounts.at(-1), {
    handle: 'newhost',
    followers: 12,
    previous_day_delta: null,
    previous_week_delta: null,
  });
  assert.deepEqual(storedBody.accounts[0], {
    handle: 'sakuramankai',
    followers: 105,
    previous_day_delta: 5,
    previous_week_delta: 15,
  });
});

test('a failed auto-added target is recorded without blocking fixed-account collection', async () => {
  const handles = [...STATIONHEAD_DAILY_FOLLOWER_HANDLES, 'stalehost'];
  let storedBody = null;
  const env = {
    BUDDIES_DB: buddiesAuthDb({ auth_token: 'token', device_uid: 'device' }),
    OTHER_DB: {
      prepare() {
        return { bind() { return { async run() { return { meta: { changes: 1 } }; } }; } };
      },
    },
    PAGES_RESPONSE_R2: {
      async get() { return null; },
      async put(_key, body) { storedBody = JSON.parse(body); },
    },
  };
  const fetchFn = async (url) => {
    const handle = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    if (handle === 'stalehost') return new Response('', { status: 404 });
    return Response.json(followerPayload(handle, 100, 1));
  };

  const result = await collectStationheadDailyFollowers(env, MIDNIGHT_JST, {
    fetchFn,
    discoverTargets: async () => ({ handles, target_writes: 0 }),
  });

  assert.equal(result.http_failures, 1);
  assert.equal(result.failures[0].handle, 'stalehost');
  assert.equal(storedBody.accounts.at(-1).handle, 'stalehost');
  assert.equal(storedBody.accounts.at(-1).followers, null);
});
