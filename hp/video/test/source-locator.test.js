import assert from 'node:assert/strict';
import test from 'node:test';

import { mediaHostFor, sourceUrlFor } from '../src/source-locator.js';

test('source locator prefers runtime values', () => {
  assert.equal(sourceUrlFor({ SOURCE_A_URL: 'https://example.test/a' }, 'A'), 'https://example.test/a');
  assert.equal(mediaHostFor({ MEDIA_HOST: 'media.example.test' }), 'media.example.test');
});

test('source locator has active repository fallback values', () => {
  assert.equal(sourceUrlFor({}, 'A'), 'https://twixive.net/ranking');
  assert.equal(sourceUrlFor({}, 'B'), 'https://twivideo.net/?ranking');
  assert.equal(sourceUrlFor({}, 'E'), 'https://www.twikeep.com/ranking?range=24h&metric=views');
  assert.match(mediaHostFor({}), /^[a-z0-9.-]+$/);
});

test('source locator rejects inactive source keys', () => {
  assert.throws(() => sourceUrlFor({}, 'C'), /Unknown source key/);
  assert.throws(() => sourceUrlFor({}, 'D'), /Unknown source key/);
});
