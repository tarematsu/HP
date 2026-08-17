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
const activePlaybackSource = readFileSync(
  new URL('../src/active-playback-feed.js', import.meta.url),
  'utf8'
);

test('complete playback feed uses bounded keyset cursor pages without a 2000-video cap', () => {
  assert.match(
    entryCoreSource,
    /intParam\(url\.searchParams\.get\('limit'\), 24, 1, 100\)/
  );
  assert.match(entryCoreSource, /nextCursor: page\.nextCursor/);
  assert.match(entryCoreSource, /options\.scope === 'all'/);
  assert.match(playerSource, /const FEED_PAGE_SIZE = 100;/);
  assert.match(playerSource, /scope: 'all'/);
  assert.match(playerSource, /while \(cursor\)/);
  assert.match(activePlaybackSource, /const MAX_PAGE_SIZE = 100;/);
  assert.match(activePlaybackSource, /video\.id > \?/);
  assert.match(activePlaybackSource, /ORDER BY video\.id/);
  assert.match(orientedPlaybackSource, /const ORIENTATION_SCAN_LIMIT = 100;/);
  assert.doesNotMatch(playerSource, /INITIAL_FEED_SIZE/);
  assert.doesNotMatch(playerSource, /MAX_FEED_PAGES/);
  assert.doesNotMatch(activePlaybackSource, /COUNT\(\*\)/);
  assert.doesNotMatch(activePlaybackSource, /OFFSET/);
  assert.doesNotMatch(playbackSource, /COUNT\(\*\)/);
  assert.doesNotMatch(playbackSource, /OFFSET/);
  assert.doesNotMatch(orientedPlaybackSource, /COUNT\(\*\)/);
  assert.doesNotMatch(orientedPlaybackSource, /OFFSET/);
});
