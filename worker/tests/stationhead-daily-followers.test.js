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

test('collector performs four HTTP reads but only one D1 write and zero D1 reads', async () => {
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
  assert.equal(result.d1_reads, 0);
  assert.equal(result.d1_rows_written, 1);
  assert.equal(result.http_requests, 4);
  assert.equal(result.inserted, true);
});
