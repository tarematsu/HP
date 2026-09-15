import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const music = source('spotify_music_target.inc');
const click = source('spotify_background_click.inc');

test('trusted Spotify CDP play click gets a five-second confirmation window end to end', () => {
  assert.match(music, /kSpotifyCdpPlayConfirmWaitMs = 5ULL \* 1000ULL/);

  const pointStart = music.indexOf('if (ParseNormalizedPoint(json, &x, &y))');
  const retryStart = music.indexOf('SetSlotState(*target, SlotState::WaitingTarget)', pointStart);
  assert.ok(pointStart >= 0 && retryStart > pointStart);

  const pointBranch = music.slice(pointStart, retryStart);
  assert.match(
    pointBranch,
    /nextRecoveryTick =\s*callbackNow \+ kSpotifyCdpPlayConfirmWaitMs/,
  );
  assert.match(pointBranch, /ClickSlotNormalizedPoint\(\*target, x, y\)/);
  assert.doesNotMatch(pointBranch, /kSpotifyPlaybackStartRetryMs/);

  assert.doesNotMatch(click, /nextRecoveryTick = now \+ kSpotifyPlaybackStartRetryMs/);
  assert.match(click, /trustedClickBlockedUntilTick = now \+ kSpotifyCdpPlayConfirmWaitMs/);
});

test('direct play and CDP click both use five-second confirmation windows', () => {
  assert.match(music, /kSpotifyDirectPlayConfirmWaitMs = 5ULL \* 1000ULL/);
  assert.match(music, /kSpotifyCdpPlayConfirmWaitMs = 5ULL \* 1000ULL/);
});
