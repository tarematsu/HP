import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const playback = await readFile(new URL('../src/playback-feed.js', import.meta.url), 'utf8');
const oriented = await readFile(
  new URL('../src/oriented-playback-feed.js', import.meta.url),
  'utf8'
);

test('cursor playback avoids offset-prefix array assembly', () => {
  assert.match(playback, /collectPlaybackCursorPage/);
  assert.match(oriented, /parsePlaybackCursor/);
  assert.match(oriented, /encodePlaybackCursor/);
  for (const source of [playback, oriented]) {
    assert.equal(source.includes('firstRows.concat'), false);
    assert.equal(source.includes('results.flatMap'), false);
    assert.equal(source.includes('firstRows.slice(0, limit)'), false);
  }
});
