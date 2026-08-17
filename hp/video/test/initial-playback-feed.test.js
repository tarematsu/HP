import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const playerSource = readFileSync(
  new URL('../public/app-resilient.js', import.meta.url),
  'utf8'
);

test('initial playback feed exhausts all active-video cursor pages', () => {
  // Each request remains capped at 100 rows, but the player continues until the
  // server reports no next cursor instead of stopping after a fixed page count.
  assert.match(playerSource, /const FEED_PAGE_SIZE = 100;/);
  assert.match(playerSource, /scope: 'all'/);
  assert.match(playerSource, /let cursor = 'start';/);
  assert.match(playerSource, /while \(cursor\)/);
  assert.match(playerSource, /seenCursors\.has\(cursor\)/);
  assert.match(playerSource, /cursor = typeof data\.nextCursor/);
  assert.match(playerSource, /return matches;/);
  assert.doesNotMatch(playerSource, /INITIAL_FEED_SIZE/);
  assert.doesNotMatch(playerSource, /ORIENTED_INITIAL_FEED_SIZE/);
  assert.doesNotMatch(playerSource, /MAX_FEED_PAGES/);
  assert.doesNotMatch(playerSource, /targetSize/);
  assert.doesNotMatch(playerSource, /nextOffset/);
  assert.doesNotMatch(playerSource, /offset: String\(offset\)/);
});
