import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OHISAMA_FOLLOWER_EXCLUDED_HANDLES,
  activeBroadcastFollowerRegistrar,
} from '../src/ohisama-pages-entry.js';

test('Ohisama follower target registration only runs for an active broadcast', async () => {
  const calls = [];
  const guarded = activeBroadcastFollowerRegistrar(async (...args) => {
    calls.push(args);
    return true;
  });

  assert.equal(await guarded({}, { is_broadcasting: 1, host_handle: 'livehost' }, 100), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].host_handle, 'livehost');

  assert.equal(await guarded({}, { is_broadcasting: 0, host_handle: 'stalehost' }, 101), false);
  assert.equal(await guarded({}, { is_broadcasting: null, host_handle: 'unknownhost' }, 102), false);
  assert.equal(calls.length, 1);
});

test('46fm and buddy46 are never registered as Ohisama follower targets', async () => {
  assert.deepEqual(OHISAMA_FOLLOWER_EXCLUDED_HANDLES, ['46fm', 'buddy46']);
  let calls = 0;
  const guarded = activeBroadcastFollowerRegistrar(async () => {
    calls += 1;
    return true;
  });

  assert.equal(await guarded({}, { is_broadcasting: 1, host_handle: '46FM' }, 200), false);
  assert.equal(await guarded({}, { is_broadcasting: 1, host_handle: ' buddy46 ' }, 201), false);
  assert.equal(calls, 0);
});

test('Ohisama follower target guard requires a registrar function', () => {
  assert.throws(() => activeBroadcastFollowerRegistrar(null), /must be a function/);
});
