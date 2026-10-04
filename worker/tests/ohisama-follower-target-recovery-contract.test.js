import assert from 'node:assert/strict';
import test from 'node:test';

import { ohisamaFollowerRegistrar } from '../src/ohisama-pages-entry.js';
import { OHISAMA_FOLLOWER_TARGET_CACHE_KEY } from '../src/ohisama-follower-target-cache.js';

function cachedEnv(handle) {
  const values = new Map([[OHISAMA_FOLLOWER_TARGET_CACHE_KEY, JSON.stringify({
    version: 3,
    updated_at: 1,
    handles: [handle],
  })]]);
  return {
    PAGES_RESPONSE_R2: {
      async get(key) {
        const raw = values.get(key);
        return raw == null ? null : { async json() { return JSON.parse(raw); } };
      },
      async put(key, value) { values.set(key, String(value)); },
    },
  };
}

test('cached Ohisama metadata never suppresses authoritative live target confirmation', async () => {
  const env = cachedEnv('cachedhost');
  let registryCalls = 0;
  let initialCalls = 0;
  const registrar = ohisamaFollowerRegistrar({
    registerFollowerTarget: async () => {
      registryCalls += 1;
      return registryCalls === 1;
    },
    collectInitialFollowers: async () => {
      initialCalls += 1;
      return true;
    },
  });
  const snapshot = { host_handle: 'cachedhost', is_broadcasting: 1 };

  assert.equal(await registrar(env, snapshot, 1000), true);
  assert.equal(await registrar(env, snapshot, 2000), false);
  assert.equal(registryCalls, 2);
  assert.equal(initialCalls, 0);
});
