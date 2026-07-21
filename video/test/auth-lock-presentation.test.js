import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { pauseMediaElements } from '../public/admin-token.js';

const authSource = await readFile(new URL('../public/admin-token.js', import.meta.url), 'utf8');

test('authentication lock pauses every media element even if one fails', () => {
  const calls = [];
  const media = [
    { pause: () => calls.push('video') },
    { pause: () => { throw new Error('renderer gone'); } },
    { pause: () => calls.push('audio') }
  ];

  assert.equal(pauseMediaElements(media), 2);
  assert.deepEqual(calls, ['video', 'audio']);
});

test('authentication lock accepts empty media collections', () => {
  assert.equal(pauseMediaElements(), 0);
  assert.equal(pauseMediaElements([]), 0);
});

test('late fullscreen and orientation changes are released while locked', () => {
  assert.match(authSource, /addEventListener\('fullscreenchange', releasePresentationIfLocked\)/);
  assert.match(authSource, /orientation\?\.addEventListener\?\.\('change', releasePresentationIfLocked\)/);
  assert.match(authSource, /classList\.contains\('is-locked'\)/);
});
