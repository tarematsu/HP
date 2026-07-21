import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const playerSource = readFileSync(
  new URL('../public/app-resilient.js', import.meta.url),
  'utf8'
);

test('initial playback feed uses bounded cursor invocations and a smaller oriented target', () => {
  assert.match(playerSource, /const FEED_PAGE_SIZE = 100;/);
  assert.match(playerSource, /const INITIAL_FEED_SIZE = 500;/);
  assert.match(playerSource, /const ORIENTED_INITIAL_FEED_SIZE = 200;/);
  assert.match(playerSource, /const MAX_FEED_PAGES = 5;/);
  assert.match(
    playerSource,
    /const targetSize = state\.orientation === 'both'[\s\S]*?ORIENTED_INITIAL_FEED_SIZE;/
  );
  assert.match(
    playerSource,
    /while \(matches\.length < targetSize && pages < MAX_FEED_PAGES\)/
  );
  assert.match(playerSource, /if \(matches\.length >= targetSize\) break;/);
  assert.match(playerSource, /return matches\.slice\(0, targetSize\);/);
  assert.match(playerSource, /cursor: cursor \|\| 'start'/);
  assert.match(playerSource, /cursor = typeof data\.nextCursor/);
  assert.match(playerSource, /if \(!cursor\) break;/);
  assert.doesNotMatch(playerSource, /nextOffset/);
  assert.doesNotMatch(playerSource, /offset: String\(offset\)/);
});
