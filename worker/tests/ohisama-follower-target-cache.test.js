import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OHISAMA_FOLLOWER_TARGET_CACHE_KEY,
  cachedOhisamaFollowerTargetRegistrar,
} from '../src/ohisama-follower-target-cache.js';

class FakeR2 {
  constructor() {
    this.values = new Map();
    this.gets = 0;
    this.puts = 0;
  }

  async get(key) {
    this.gets += 1;
    const raw = this.values.get(key);
    if (raw == null) return null;
    return {
      async json() { return JSON.parse(raw); },
      async text() { return raw; },
    };
  }

  async put(key, value) {
    this.puts += 1;
    this.values.set(key, String(value));
  }
}

test('Ohisama follower target D1 registration runs only once per cached host', async () => {
  const r2 = new FakeR2();
  let registrations = 0;
  const registrar = cachedOhisamaFollowerTargetRegistrar(async () => {
    registrations += 1;
    return registrations === 1;
  });
  const env = { PAGES_RESPONSE_R2: r2 };
  const snapshot = { host_handle: 'Host_A' };

  assert.equal(await registrar(env, snapshot, 1000), true);
  assert.equal(await registrar(env, snapshot, 2000), false);
  assert.equal(registrations, 1);
  assert.equal(r2.puts, 1);

  const cached = JSON.parse(r2.values.get(OHISAMA_FOLLOWER_TARGET_CACHE_KEY));
  assert.equal(cached.version, 3);
  assert.deepEqual(cached.handles, ['host_a']);
});

test('version 1 cache is invalidated once so existing hosts receive membership metadata', async () => {
  const r2 = new FakeR2();
  r2.values.set(OHISAMA_FOLLOWER_TARGET_CACHE_KEY, JSON.stringify({
    version: 1,
    updated_at: 500,
    handles: ['host-a'],
  }));
  let registrations = 0;
  const registrar = cachedOhisamaFollowerTargetRegistrar(async () => {
    registrations += 1;
    return false;
  });

  assert.equal(await registrar({ PAGES_RESPONSE_R2: r2 }, { host_handle: 'host-a' }, 1000), false);
  assert.equal(registrations, 1);
  const cached = JSON.parse(r2.values.get(OHISAMA_FOLLOWER_TARGET_CACHE_KEY));
  assert.equal(cached.version, 3);
  assert.deepEqual(cached.handles, ['host-a']);
});

test('Ohisama follower target cache records known existing targets after a successful no-op UPSERT', async () => {
  const r2 = new FakeR2();
  let registrations = 0;
  const registrar = cachedOhisamaFollowerTargetRegistrar(async () => {
    registrations += 1;
    return false;
  });
  const env = { PAGES_RESPONSE_R2: r2 };

  assert.equal(await registrar(env, { host_handle: 'host-b' }, 1000), false);
  assert.equal(await registrar(env, { host_handle: 'host-b' }, 2000), false);
  assert.equal(registrations, 1);
});

test('Ohisama follower target cache does not hide registration failures', async () => {
  const r2 = new FakeR2();
  const registrar = cachedOhisamaFollowerTargetRegistrar(async () => {
    throw new Error('D1 unavailable');
  });

  await assert.rejects(
    registrar({ PAGES_RESPONSE_R2: r2 }, { host_handle: 'host-c' }, 1000),
    /D1 unavailable/,
  );
  assert.equal(r2.puts, 0);
});
