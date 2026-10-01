import assert from 'node:assert/strict';
import test from 'node:test';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';
import { collectInitialStationheadFollowers, registerBuddiesInitialFollowerTarget } from '../src/stationhead-initial-followers.js';
import { activeBroadcastFollowerRegistrar } from '../src/ohisama-pages-entry.js';
import { cachedOhisamaFollowerTargetRegistrar } from '../src/ohisama-follower-target-cache.js';
import { withOhisamaFollowerMembership } from '../src/ohisama-follower-membership.js';

function fixture() {
  const values = new Map();
  const writes = [];
  const env = {
    OTHER_DB: { prepare(sql) { return { bind(...args) { return { async run() { writes.push({ sql, args }); return { meta: { changes: 1 } }; } }; } }; } },
    PAGES_RESPONSE_R2: {
      async get(key) { return values.has(key) ? { async json() { return JSON.parse(values.get(key)); } } : null; },
      async put(key, value) { values.set(key, value); },
    },
  };
  values.set(pagesR2ResponseKey('followers'), JSON.stringify({
    handles: ['existing'], rows: [{ date: '2026-10-01', existing: 100 }],
    memberships: { existing: { affiliation: 'Buddies', group: 'sakurazaka46' } },
  }));
  return { env, values, writes };
}

test('initial sample publishes only the new host and leaves daily completion untouched', async () => {
  const { env, values, writes } = fixture();
  let calls = 0;
  const options = { session: {}, sourceMask: 4, fetchProfile: async (handle) => { calls++; assert.equal(handle, 'newhost'); return { followers: 42 }; } };
  const at = Date.parse('2026-10-01T18:00:00Z');
  assert.equal(await collectInitialStationheadFollowers(env, 'NewHost', at, options), true);
  assert.equal(await collectInitialStationheadFollowers(env, 'newhost', at + 60000, options), false);
  const model = JSON.parse(values.get(pagesR2ResponseKey('followers')));
  assert.equal(calls, 1);
  assert.equal(writes.length, 0);
  assert.equal(model.rows.find(row => row.date === '2026-10-02').newhost, 42);
  assert.equal(model.rows.find(row => row.date === '2026-10-01').existing, 100);
  assert.equal(model.memberships.existing.affiliation, 'Buddies');
  assert.equal(model.memberships.newhost.affiliation, 'Ohisama');
});

test('failed initial fetch remains eligible for retry', async () => {
  const { env, values } = fixture();
  await assert.rejects(collectInitialStationheadFollowers(env, 'newhost', Date.now(), {
    session: {}, fetchProfile: async () => { throw new Error('temporary'); },
  }), /temporary/);
  assert.equal(JSON.parse(values.get(pagesR2ResponseKey('followers'))).handles.includes('newhost'), false);
});

test('initial collection keeps missing historical counts sparse', async () => {
  const { env, values } = fixture();
  const model = JSON.parse(values.get(pagesR2ResponseKey('followers')));
  model.rows[0].newhost = null;
  values.set(pagesR2ResponseKey('followers'), JSON.stringify(model));
  await collectInitialStationheadFollowers(env, 'newhost', Date.parse('2026-10-02T01:00:00Z'), {
    session: {}, fetchProfile: async () => ({ followers: 42 }),
  });
  const result = JSON.parse(values.get(pagesR2ResponseKey('followers')));
  assert.equal(Object.hasOwn(result.rows[0], 'newhost'), false);
  assert.equal(result.accounts.find(account => account.handle === 'newhost').previous_day_delta, null);
});

test('Ohisama registrar forwards live credentials through every wrapper without saved auth', async () => {
  const { env } = fixture();
  const session = { authToken: 'live-token', deviceUid: 'live-device' };
  const registrar = activeBroadcastFollowerRegistrar(cachedOhisamaFollowerTargetRegistrar(withOhisamaFollowerMembership(
    async (targetEnv, snapshot, observedAt, state) => {
      assert.equal(state, session);
      return collectInitialStationheadFollowers(targetEnv, snapshot.host_handle, observedAt, {
        session: { auth_token: state.authToken, device_uid: state.deviceUid },
        fetchFn: async (_url, init) => {
          assert.equal(init.headers.authorization, 'Bearer live-token');
          assert.equal(init.headers['sth-device-uid'], 'live-device');
          return Response.json({ account: { handle: 'newhost', followers: 42 } });
        },
      });
    },
  )));
  assert.equal(await registrar(env, { host_handle: 'newhost', is_broadcasting: 1 }, Date.now(), session), true);
});

test('Buddies registers a live host once and skips inactive broadcasts', async () => {
  const { env, values, writes } = fixture();
  const model = JSON.parse(values.get(pagesR2ResponseKey('followers')));
  model.rows[0].newhost = 12;
  values.set(pagesR2ResponseKey('followers'), JSON.stringify(model));
  const snapshot = { host_handle: 'newhost', is_broadcasting: 1 };
  assert.equal(await registerBuddiesInitialFollowerTarget(env, { ...snapshot, is_broadcasting: 0 }, Date.now()), false);
  assert.equal(await registerBuddiesInitialFollowerTarget(env, snapshot, Date.now()), true);
  assert.equal(await registerBuddiesInitialFollowerTarget(env, snapshot, Date.now()), false);
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /sh_stationhead_follower_targets/);
});
