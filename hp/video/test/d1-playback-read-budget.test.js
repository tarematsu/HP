import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entryCoreSource = readFileSync(
  new URL('../src/entry-core.js', import.meta.url),
  'utf8'
);
const playerSource = readFileSync(
  new URL('../public/app-resilient.js', import.meta.url),
  'utf8'
);
const playbackSource = readFileSync(
  new URL('../src/playback-feed.js', import.meta.url),
  'utf8'
);
const orientedPlaybackSource = readFileSync(
  new URL('../src/oriented-playback-feed.js', import.meta.url),
  'utf8'
);

test('initial playback feeds load 1000 URLs through bounded cursor pages', () => {
  assert.match(
    entryCoreSource,
    /intParam\(url\.searchParams\.get\('limit'\), 24, 1, 100\)/
  );
  assert.match(entryCoreSource, /nextCursor: page\.nextCursor/);
  assert.match(playerSource, /const FEED_PAGE_SIZE = 100;/);
  assert.match(playerSource, /const INITIAL_FEED_SIZE = 1000;/);
  assert.match(playerSource, /const ORIENTED_INITIAL_FEED_SIZE = 1000;/);
  assert.match(playerSource, /const MAX_FEED_PAGES = 10;/);
  assert.match(orientedPlaybackSource, /const ORIENTATION_SCAN_LIMIT = 100;/);
  assert.doesNotMatch(playbackSource, /COUNT\(\*\)/);
  assert.doesNotMatch(playbackSource, /OFFSET/);
  assert.doesNotMatch(orientedPlaybackSource, /COUNT\(\*\)/);
  assert.doesNotMatch(orientedPlaybackSource, /OFFSET/);
});
