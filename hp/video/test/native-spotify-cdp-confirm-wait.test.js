import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const music = source('spotify_music_target.inc');
const click = source('spotify_background_click.inc');

test('trusted Spotify CDP play click gets a five-second confirmation window end to end', () => {
  assert.match(music, /kSpotifyCdpPlayConfirmWaitMs = 5ULL \* 1000ULL/);

  const pointStart = music.indexOf('if (ParseCssPoint(json, &cssX, &cssY))');
  const retryStart = music.indexOf('SetSlotState(*target, SlotState::WaitingTarget)', pointStart);
  assert.ok(pointStart >= 0 && retryStart > pointStart);

  const pointBranch = music.slice(pointStart, retryStart);
  assert.match(
    pointBranch,
    /nextRecoveryTick =\s*callbackNow \+ kSpotifyCdpPlayConfirmWaitMs/,
  );
  assert.match(pointBranch, /ClickSlotCssPoint\(\*target, cssX, cssY\)/);
  assert.doesNotMatch(pointBranch, /kSpotifyPlaybackStartRetryMs/);

  assert.doesNotMatch(click, /nextRecoveryTick = now \+ kSpotifyPlaybackStartRetryMs/);
  assert.match(click, /trustedClickBlockedUntilTick = now \+ kSpotifyCdpPlayConfirmWaitMs/);
});

test('playback startup has one CDP confirmation window and no direct-play path', () => {
  assert.match(music, /kSpotifyCdpPlayConfirmWaitMs = 5ULL \* 1000ULL/);
  assert.doesNotMatch(music, /kSpotifyDirectPlayConfirmWaitMs|direct-play|DirectPlay/);
});

test('verified CSS point is dispatched without native pixel rescaling', () => {
  assert.match(click, /ParseCssPoint\(json, &verifiedX, &verifiedY\)/);
  assert.match(click, /DispatchSpotifyDevToolsClick\(\*target, verifiedX, verifiedY\)/);
  assert.match(click, /const double x = cssX;/);
  assert.match(click, /const double y = cssY;/);
  assert.doesNotMatch(click, /get_ZoomFactor|get_RasterizationScale|GetDpiForWindow|cssWidth|cssHeight/);
});
