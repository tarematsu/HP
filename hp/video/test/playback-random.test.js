import assert from 'node:assert/strict';
import test from 'node:test';

import { pickRandomIndexExcluding } from '../public/playback-random.js';

test('pickRandomIndexExcluding never selects the current video', () => {
  const values = [0, 1, 2, 3];
  const selected = values.map((value) => pickRandomIndexExcluding(5, 2, (buffer) => {
    buffer[0] = value;
  }));

  assert.deepEqual(selected, [0, 1, 3, 4]);
  assert.equal(selected.includes(2), false);
});

test('pickRandomIndexExcluding samples the full range when there is no exclusion', () => {
  assert.equal(pickRandomIndexExcluding(5, -1, (buffer) => { buffer[0] = 2; }), 2);
});

test('pickRandomIndexExcluding retries values outside the unbiased range', () => {
  let calls = 0;
  const selected = pickRandomIndexExcluding(4, 1, (buffer) => {
    buffer[0] = calls++ === 0 ? 0xffffffff : 0;
  });

  assert.equal(calls, 2);
  assert.equal(selected, 0);
});

test('single-item feeds remain playable', () => {
  assert.equal(pickRandomIndexExcluding(1, 0, null), 0);
});
