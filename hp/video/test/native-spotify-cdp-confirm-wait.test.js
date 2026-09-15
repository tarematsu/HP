import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const music = readFileSync(
  new URL('../../native/src/spotify_music_target.inc', import.meta.url),
  'utf8',
);

test('trusted Spotify CDP play click gets a five-second confirmation window', () => {
  assert.match(music, /kSpotifyCdpPlayConfirmWaitMs = 5ULL \* 1000ULL/);

  const pointStart = music.indexOf('if (ParseNormalizedPoint(json, &x, &y))');
  const recoveringStart = music.indexOf('MarkSlotRecovering(*target', pointStart);
  assert.ok(pointStart >= 0 && recoveringStart > pointStart);

  const pointBranch = music.slice(pointStart, recoveringStart);
  assert.match(
    pointBranch,
    /nextRecoveryTick =\s*callbackNow \+ kSpotifyCdpPlayConfirmWaitMs/,
  );
  assert.match(pointBranch, /ClickSlotNormalizedPoint\(\*target, x, y\)/);
  assert.doesNotMatch(pointBranch, /kSpotifyPlaybackStartRetryMs/);
});

test('direct play and CDP click both use five-second confirmation windows', () => {
  assert.match(music, /kSpotifyDirectPlayConfirmWaitMs = 5ULL \* 1000ULL/);
  assert.match(music, /kSpotifyCdpPlayConfirmWaitMs = 5ULL \* 1000ULL/);
});
