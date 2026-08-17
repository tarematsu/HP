import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const playerSource = readFileSync(new URL('../public/app-resilient.js', import.meta.url), 'utf8');

test('player resumes a persisted per-orientation shuffle bag', () => {
  assert.match(playerSource, /const PLAYBACK_BAG_KEY = 'video-scraper-playback-bag-v1';/);
  assert.match(playerSource, /return `\$\{PLAYBACK_BAG_KEY\}:\$\{state\.orientation\}`;/);
  assert.match(playerSource, /const continueRound = !forceNewRound[\s\S]*savedBag\.remainingIds\.length > 0;/);
  assert.match(playerSource, /restorePlaybackBagItems\(fetchedItems, savedBag\)/);
  assert.match(playerSource, /persistPlaybackProgress\(result\.index\);/);
});

test('player consumes the bag in order and only creates a new round at the end', () => {
  assert.match(playerSource, /const nextIndex = state\.activeIndex \+ 1;/);
  assert.match(playerSource, /let startIndex = preloadedIndex > state\.activeIndex[\s\S]*state\.activeIndex \+ 1;/);
  assert.match(playerSource, /if \(startIndex >= state\.items\.length\) \{[\s\S]*loadPlaybackRound\(generation, true\)/);
  assert.doesNotMatch(playerSource, /pickRandomIndexExcluding/);
  assert.doesNotMatch(playerSource, /\(state\.activeIndex \+ 1\) % state\.items\.length/);
});
