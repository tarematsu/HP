import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STATIONHEAD_DAILY_FOLLOWER_HANDLES,
  collectStationheadDailyFollowers,
  followerProfileFromPayload,
  isJstMidnightMinute,
  jstDateKey,
} from '../src/stationhead-daily-followers.js';

const MIDNIGHT_JST = Date.parse('2026-09-30T15:00:00.000Z');

function followerPayload(handle, followers, id) {
  return { data: { account: { id, handle, followers } } };
}

test('daily follower schedule fires only at the JST midnight minute', () => {
  assert.equal(isJstMidnightMinute(MIDNIGHT_JST), true);
  assert.equal(isJstMidnightMinute(MIDNIGHT_JST + 59_999), true);
  assert.equal(isJstMidnightMinute(MIDNIGHT_JST + 60_000), false);
  assert.equal(jstDateKey(MIDNIGHT_JST), '2026-10-01');
});

test('profile extraction requires a non-negative follower count', () => {
  assert.deepEqual(
    followerProfileFromPayload(followerPayload('sakuramankai', 1234, 99), 'sakuramankai'),
    { handle: 'sakuramankai', account_id: 99, followers: 1234 },
  );
  assert.throws(
    () => followerProfileFromPayload({ account: { handle: 'sakuramankai' } }, 'sakuramankai'),
    /followers missing/,
  );
});

test('collector performs four HTTP reads, one R2 read/write, one D1 write and zero D1 reads', async () => {
  const counts = new Map([
    ['sakuramankai', 101],
    ['sakuramankai2', 202],
    ['sakurazaka46jp', 303],
    ['nogizaka46smej', 404],
  ]);
  const requested = [];
  const fetchFn = async (url) => {
    const handle = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    requested.push(handle);
    return Response.json(followerPayload(handle, counts.get(handle), requested.length));
  };

  let prepareCount = 0;
  let runCount = 0;
  let bound = null;
  let r2Reads = 0;
  let r2Writes = 0;
  let storedBody = null;
  let storedOptions = null;
  const env = {
    OTHER_DB: {
      prepare(sql) {
        prepareCount += 1;
        assert.match(sql, /INSERT INTO sh_stationhead_daily_followers/);
        assert.match(sql, /ON CONFLICT\(observed_date_jst\) DO NOTHING/);
        return {
          bind(...values) {
            bound = values;
            return {
              async run() {
                runCount += 1;
                return { meta: { changes: 1 } };
              },
            };
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
        storedOptions = options;
      },
    },
  };

  const result = await collectStationheadDailyFollowers(env, MIDNIGHT_JST, {
    fetchFn,
    now: () => MIDNIGHT_JST + 321,
  });

  assert.deepEqual(requested.sort(), [...STATIONHEAD_DAILY_FOLLOWER_HANDLES].sort());
  assert.equal(prepareCount, 1);
  assert.equal(runCount, 1);
  assert.deepEqual(bound, [
    '2026-10-01',
    MIDNIGHT_JST,
    MIDNIGHT_JST + 321,
    101,
    202,
    303,
    404,
  ]);
  assert.equal(r2Reads, 1);
  assert.equal(r2Writes, 1);
  assert.equal(storedBody.ok, true);
  assert.equal(storedBody.latest_date, '2026-10-01');
  assert.deepEqual(storedBody.rows, [{
    date: '2026-10-01',
    sakuramankai: 101,
    sakuramankai2: 202,
    sakurazaka46jp: 303,
    nogizaka46smej: 404,
  }]);
  assert.deepEqual(storedBody.accounts, [
    { handle: 'sakuramankai', followers: 101, previous_day_delta: null, previous_week_delta: null },
    { handle: 'sakuramankai2', followers: 202, previous_day_delta: null, previous_week_delta: null },
    { handle: 'sakurazaka46jp', followers: 303, previous_day_delta: null, previous_week_delta: null },
    { handle: 'nogizaka46smej', followers: 404, previous_day_delta: null, previous_week_delta: null },
  ]);
  assert.equal(storedOptions.customMetadata.cadence_seconds, '86400');
  assert.equal(result.d1_reads, 0);
  assert.equal(result.d1_rows_written, 1);
  assert.equal(result.r2_reads, 1);
  assert.equal(result.r2_writes, 1);
  assert.equal(result.http_requests, 4);
  assert.equal(result.inserted, true);
});

test('R2 history is de-duplicated by date and computes exact day/week deltas', async () => {
  const existing = {
    ok: true,
    rows: [
      { date: '2026-09-24', sakuramankai: 90, sakuramankai2: 190, sakurazaka46jp: 290, nogizaka46smej: 390 },
      { date: '2026-09-30', sakuramankai: 100, sakuramankai2: 200, sakurazaka46jp: 300, nogizaka46smej: 400 },
    ],
  };
  let storedBody = null;
  const counts = new Map([
    ['sakuramankai', 105],
    ['sakuramankai2', 207],
    ['sakurazaka46jp', 309],
    ['nogizaka46smej', 411],
  ]);
  const env = {
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

  await collectStationheadDailyFollowers(env, MIDNIGHT_JST, { fetchFn, now: () => MIDNIGHT_JST + 500 });

  assert.equal(storedBody.rows.length, 3);
  assert.deepEqual(storedBody.accounts[0], {
    handle: 'sakuramankai',
    followers: 105,
    previous_day_delta: 5,
    previous_week_delta: 15,
  });
  assert.deepEqual(storedBody.accounts[3], {
    handle: 'nogizaka46smej',
    followers: 411,
    previous_day_delta: 11,
    previous_week_delta: 21,
  });
});
