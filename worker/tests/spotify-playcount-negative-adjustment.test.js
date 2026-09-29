import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  countPlaycountRegressions,
  hasPlaycountAdvance,
} from '../src/spotify-playcount-collector.js';

test('downward Spotify playcount adjustments are treated as published changes', () => {
  const previous = [
    { track_id: 'a', playcount: 100 },
    { track_id: 'b', playcount: 200 },
  ];
  const adjusted = [
    { track_id: 'a', playcount: 100 },
    { track_id: 'b', playcount: 198 },
  ];

  assert.equal(hasPlaycountAdvance(previous, adjusted), true);
  assert.equal(countPlaycountRegressions(previous, adjusted), 1);
});

test('daily finalization preserves negative deltas instead of rejecting adjustments', () => {
  const consumer = readFileSync(new URL('../src/spotify-playcount-consumer.js', import.meta.url), 'utf8');

  assert.match(consumer, /c\.playcount-p\.playcount/);
  assert.match(consumer, /spotify_playcount_adjustment/);
  assert.doesNotMatch(consumer, /candidate snapshot regressed/);
});
