import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const playback = await readFile(new URL('../src/playback-feed.js', import.meta.url), 'utf8');
const oriented = await readFile(
  new URL('../src/oriented-playback-feed.js', import.meta.url),
  'utf8'
);

test('cursor playback removes boundary count caches and expiry sweeps', () => {
  assert.match(playback, /collectPlaybackCursorPage/);
  assert.match(oriented, /parsePlaybackCursor/);
  assert.match(oriented, /ORIENTATION_SCAN_LIMIT/);
  for (const source of [playback, oriented]) {
    assert.equal(source.includes('COUNT(*)'), false);
    assert.equal(source.includes('OFFSET'), false);
    assert.equal(source.includes('countCaches'), false);
    assert.equal(source.includes('segmentCountCaches'), false);
    assert.equal(source.includes('trimCache('), false);
  }
});
