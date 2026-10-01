import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publishOhisamaFollowerMembership,
  withOhisamaFollowerMembership,
} from '../src/ohisama-follower-membership.js';

function r2WithPayload(payload) {
  let stored = null;
  return {
    bucket: {
      async get(key) {
        assert.equal(key, 'pages-response/v1/followers.json');
        return payload == null ? null : { async json() { return payload; } };
      },
      async put(key, body, options) {
        assert.equal(key, 'pages-response/v1/followers.json');
        stored = { body: JSON.parse(body), options };
      },
    },
    stored: () => stored,
  };
}

test('Ohisama registration immediately materializes its affiliation in followers R2', async () => {
  const r2 = r2WithPayload({
    ok: true,
    updated_at: 100,
    latest_date: '2026-10-01',
    handles: ['sakurazaka46jp', 'ohisamahost'],
    rows: [{ date: '2026-10-01', sakurazaka46jp: 100, ohisamahost: 25 }],
    accounts: [],
    memberships: { sakurazaka46jp: { affiliation: '櫻坂46公式', group: 'sakurazaka46' } },
    failures: [],
  });
  const env = { PAGES_RESPONSE_R2: r2.bucket };

  assert.equal(await publishOhisamaFollowerMembership(env, 'OhisamaHost', 123456), true);
  assert.deepEqual(r2.stored().body.memberships.ohisamahost, {
    affiliation: 'Ohisama',
    group: 'hinatazaka46',
  });
  assert.equal(r2.stored().body.updated_at, 123456);
  assert.equal(r2.stored().body.rows[0].ohisamahost, 25);
});

test('membership publish runs even when target registry is already cached', async () => {
  const r2 = r2WithPayload({ ok: true, handles: [], rows: [], accounts: [], memberships: {}, failures: [] });
  const env = { PAGES_RESPONSE_R2: r2.bucket };
  let registrarCalls = 0;
  const wrapped = withOhisamaFollowerMembership(async () => {
    registrarCalls += 1;
    return false;
  });

  assert.equal(await wrapped(env, { host_handle: 'existinghost' }, 222), false);
  assert.equal(registrarCalls, 1);
  assert.deepEqual(r2.stored().body.memberships.existinghost, {
    affiliation: 'Ohisama',
    group: 'hinatazaka46',
  });
});
