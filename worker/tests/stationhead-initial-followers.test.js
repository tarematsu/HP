import assert from 'node:assert/strict';
import test from 'node:test';
import { pagesR2ResponseKey } from '../src/pages-response-r2.js';
import { collectInitialStationheadFollowers, registerBuddiesInitialFollowerTarget } from '../src/stationhead-initial-followers.js';
import { ohisamaFollowerRegistrar } from '../src/ohisama-pages-entry.js';
import { OHISAMA_FOLLOWER_TARGET_CACHE_KEY } from '../src/ohisama-follower-target-cache.js';

function fixture() {
  const values = new Map();
  const writes = [];
  const registeredTargets = new Set();
  const env = {
    OTHER_DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async run() {
                writes.push({ sql, args });
                if (/sh_stationhead_follower_targets/.test(sql)) {
                  const handle = String(args[0] || '');
                  const changes = registeredTargets.has(handle) ? 0 : 1;
                  registeredTargets.add(handle);
                  return { meta: { changes } };
                }
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
    PAGES_RESPONSE_R2: {
      async get(key) { return values.has(key) ? { async json() { return JSON.parse(values.get(key)); } } : null; },
      async put(key, value) { values.set(key, value); },
    },
  };
  values.set(pagesR2ResponseKey('followers'), JSON.stringify({
    handles: ['existing'], rows: [{ date: '2026-10-01', existing: 100 }],
    memberships: { existing: { affiliation: 'Buddies', group: 'sakurazaka46' } },
  }));
  return { env, values, writes, registeredTargets };
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

test('Ohisama registrar forwards live credentials while caching only optional initial metadata', async () => {
  const { env } = fixture();
  const session = { authToken: 'live-token', deviceUid: 'live-device' };
  let registrations = 0;
  let initialCollections = 0;
  const registrar = ohisamaFollowerRegistrar({
    registerFollowerTarget: async (_targetEnv, snapshot) => {
      registrations += 1;
      assert.equal(snapshot.host_handle, 'newhost');
      return true;
    },
    collectInitialFollowers: async (_targetEnv, handle, _observedAt, options) => {
      initialCollections += 1;
      assert.equal(handle, 'newhost');
      assert.deepEqual(options.session, { auth_token: 'live-token', device_uid: 'live-device' });
      return true;
    },
  });
  assert.equal(await registrar(env, { host_handle: 'newhost', is_broadcasting: 1 }, Date.now(), session), true);
  assert.equal(registrations, 1);
  assert.equal(initialCollections, 1);
});

test('Ohisama live target registration bypasses a stale R2 metadata cache', async () => {
  const { env, values } = fixture();
  values.set(OHISAMA_FOLLOWER_TARGET_CACHE_KEY, JSON.stringify({
    version: 3,
    updated_at: 500,
    handles: ['newhost'],
  }));
  let registrations = 0;
  let initialCollections = 0;
  const registrar = ohisamaFollowerRegistrar({
    registerFollowerTarget: async () => {
      registrations += 1;
      return registrations === 1;
    },
    collectInitialFollowers: async () => {
      initialCollections += 1;
      return true;
    },
  });
  const snapshot = { host_handle: 'newhost', is_broadcasting: 1 };

  assert.equal(await registrar(env, snapshot, 1000), true);
  assert.equal(await registrar(env, snapshot, 2000), false);
  assert.equal(registrations, 2);
  assert.equal(initialCollections, 0);
});

test('Buddies registers only a live-observed host and retries registry confirmation even with an R2 marker', async () => {
  const { env, values, writes } = fixture();
  const model = JSON.parse(values.get(pagesR2ResponseKey('followers')));
  model.rows[0].newhost = 12;
  values.set(pagesR2ResponseKey('followers'), JSON.stringify(model));
  const snapshot = { host_handle: 'newhost', is_broadcasting: 1 };
  const firstAt = 123456;
  const secondAt = 123457;

  assert.equal(await registerBuddiesInitialFollowerTarget(env, { ...snapshot, is_broadcasting: 0 }, firstAt), false);
  assert.equal(writes.length, 0);

  assert.equal(await registerBuddiesInitialFollowerTarget(env, snapshot, firstAt), true);
  assert.equal(await registerBuddiesInitialFollowerTarget(env, snapshot, secondAt), false);
  assert.equal(writes.length, 2);
  assert.match(writes[0].sql, /sh_stationhead_follower_targets/);
  assert.match(writes[0].sql, /live_confirmed_at/);
  assert.deepEqual(writes[0].args, ['newhost', firstAt, firstAt]);
});
