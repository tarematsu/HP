import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const stationheadEvents = source('sh_webview_event_policy.h');
const stationheadLoss = source('sh_audio_loss.cpp');
const stationheadPolicy = source('sh_audio_loss_policy.h');
const spotifyEvents = source('spotify_media_observer_events.inc');
const spotifyClick = source('spotify_background_click.inc');

test('Stationhead actively repairs silence before the existing fallback boundary', () => {
  assert.match(stationheadEvents, /get_IsDocumentPlayingAudio/);
  assert.match(stationheadEvents, /__homepanelStationheadNativeAudioSeen/);
  assert.match(stationheadEvents, /nativeSetTimeout\(begin, 4000\)/);
  assert.match(stationheadEvents, /nativeSetInterval\([^]*2000\)/);
  assert.match(stationheadEvents, /attempts >= 4/);
  assert.match(stationheadEvents, /__homepanelPrimaryStationhead\?\.scan\?\.\(0\)/);
  assert.match(stationheadEvents, /media\.pause\(\)/);
  assert.match(stationheadEvents, /media\.play\?\.\(\)/);
  assert.match(stationheadEvents, /__homepanelStationheadBlockingLoginVisible/);
  assert.doesNotMatch(stationheadEvents, /location\.reload\(\)/);

  // The new bounded repair loop must finish before the audited auth/fallback
  // state machine takes over at 11/12 seconds.
  assert.match(stationheadPolicy, /kStationheadAudioLossGraceMs = 11'000/);
  assert.match(stationheadPolicy, /kStationheadAudioLossDomSettleMs = 1'000/);
  assert.match(stationheadLoss, /SetManagedPlaybackFallback/);
});

test('Spotify sustained silence returns to trusted click and reload recovery', () => {
  assert.match(spotifyEvents, /recoveryGraceMs = 6000/);
  for (const eventName of ['pause', 'stalled', 'waiting', 'error']) {
    assert.match(spotifyEvents, new RegExp(`['\"]${eventName}['\"]`));
  }
  assert.match(spotifyEvents, /post\('spotify:timed-interrupted'\)/);
  assert.match(spotifyEvents, /next > recoveryTime \+ 0\.10/);
  assert.match(
    spotifyClick,
    /slot\.playbackConfirmed && slot\.state == SlotState::Playing/,
  );
  assert.match(spotifyClick, /retry\.count>=2/);
  assert.match(spotifyClick, /return 'reload'/);
});
