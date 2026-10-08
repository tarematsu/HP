import assert from 'node:assert/strict';
import test from 'node:test';
import { stationheadPlaybackCapture, stationheadInitialFollowerRegistrar } from '../src/stationhead-source-runtime.js';

test('runtime hooks follow shared Stationhead source aliases', () => {
  const playback = stationheadPlaybackCapture('buddies');
  const followers = stationheadInitialFollowerRegistrar('buddies');
  assert.equal(typeof playback, 'function');
  assert.equal(typeof followers, 'function');
  for (const alias of [' BUDDY46 ', 'sakurazaka']) {
    assert.equal(stationheadPlaybackCapture(alias), playback);
    assert.equal(stationheadInitialFollowerRegistrar(alias), followers);
  }
  for (const source of ['ohisama', 'nogizaka', 'unknown']) {
    assert.equal(stationheadPlaybackCapture(source), null);
    assert.equal(stationheadInitialFollowerRegistrar(source), null);
  }
});
