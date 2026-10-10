import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const playerSource = readFileSync(new URL('../public/app-resilient.js', import.meta.url), 'utf8');

test('opening the player starts a fresh round, even with saved playback progress', () => {
  const opening = playerSource.split('async function showFirst() {')[1]
    .split('async function nextVideo(')[0];
  assert.match(opening, /const items = await loadPlaybackRound\(generation, true\);/);
  assert.match(playerSource, /const continueRound = !forceNewRound[\s\S]*savedBag\.remainingIds\.length > 0;/);
  assert.match(playerSource, /const fetchSeed = continueRound \? savedBag\.seed : createFeedSeed\(\);/);
  assert.match(playerSource, /function selectOrientation\(value\) \{[\s\S]*showFirst\(\)\.catch/);
  assert.match(playerSource, /showFirst\(\)\.catch\(\(\) => \{\}\);\s*$/);
});

test('player consumes the bag in order and only creates a new round at the end', () => {
  assert.match(playerSource, /const nextIndex = state\.activeIndex \+ 1;/);
  assert.match(playerSource, /let startIndex = preloadedIndex > state\.activeIndex[\s\S]*state\.activeIndex \+ 1;/);
  assert.match(playerSource, /if \(startIndex >= state\.items\.length\) \{[\s\S]*loadPlaybackRound\(generation, true\)/);
  assert.doesNotMatch(playerSource, /pickRandomIndexExcluding/);
  assert.doesNotMatch(playerSource, /\(state\.activeIndex \+ 1\) % state\.items\.length/);
});

test('player requests and exhausts the complete active-video feed instead of stopping at 2000', () => {
  assert.match(playerSource, /scope: 'all'/);
  assert.match(playerSource, /while \(cursor\)/);
  assert.match(playerSource, /seenCursors\.has\(cursor\)/);
  assert.doesNotMatch(playerSource, /INITIAL_FEED_SIZE/);
  assert.doesNotMatch(playerSource, /ORIENTED_INITIAL_FEED_SIZE/);
  assert.doesNotMatch(playerSource, /MAX_FEED_PAGES/);
  assert.doesNotMatch(playerSource, /slice\(0, targetSize\)/);
});
