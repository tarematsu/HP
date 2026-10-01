import assert from 'node:assert/strict';
import test from 'node:test';

import { activeBroadcastFollowerRegistrar } from '../src/ohisama-pages-entry.js';

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

test('Ohisama follower target guard requires a registrar function', () => {
  assert.throws(() => activeBroadcastFollowerRegistrar(null), /must be a function/);
});
