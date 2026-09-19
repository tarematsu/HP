import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePlaybackTrack } from '../functions/lib/playback.js';

test('dashboard playback does not let placeholder titles mask fallback metadata', () => {
  const playback = { currentIndex: -1, progressMs: 0 };

  const fromRaw = normalizePlaybackTrack({
    title: '曲名...',
    raw_json: {
      track: {
        name: 'Recovered Song',
        artist_name: 'Recovered Artist',
      },
    },
    duration_ms: 238000,
  }, 0, playback);
  assert.equal(fromRaw.title, 'Recovered Song');
  assert.equal(fromRaw.artist, 'Recovered Artist');

  const fromDisplay = normalizePlaybackTrack({
    title: '曲名不明',
    artist: '櫻坂46',
    display_title: '承認欲求 — 櫻坂46',
    duration_ms: 238000,
  }, 0, playback);
  assert.equal(fromDisplay.title, '承認欲求');
  assert.equal(fromDisplay.artist, '櫻坂46');
});
