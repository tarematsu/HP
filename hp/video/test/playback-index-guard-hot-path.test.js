import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const playbackFeed = await readFile(
  new URL('../src/playback-feed.js', import.meta.url),
  'utf8'
);
const orientedPlaybackFeed = await readFile(
  new URL('../src/oriented-playback-feed.js', import.meta.url),
  'utf8'
);

test('playback readers do not await migrated index guards per request', () => {
  assert.doesNotMatch(playbackFeed, /ensureDbIndexes/);
  assert.doesNotMatch(orientedPlaybackFeed, /ensureDbIndexes/);
});
