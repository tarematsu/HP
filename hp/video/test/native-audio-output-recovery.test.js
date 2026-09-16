import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const stationheadPolicy = source('sh_webview_event_policy.h');
const spotifyEvents = source('spotify_media_observer_events.inc');
const spotifyClick = source('spotify_background_click.inc');

test('Stationhead audio loss uses staged media retry before a guarded reload', () => {
  assert.match(stationheadPolicy, /get_IsDocumentPlayingAudio/);
  assert.match(stationheadPolicy, /__homepanelStationheadAudioRecoveryHadPlaying/);
  assert.match(stationheadPolicy, /attempts < 4/);
  assert.match(stationheadPolicy, /setInterval\([^]*2000\)/);
  assert.match(stationheadPolicy, /120000/);
  assert.match(stationheadPolicy, /location\.reload\(\)/);
  assert.match(stationheadPolicy, /loginPattern/);
});

test('Spotify sustained playback interruption returns to trusted native recovery', () => {
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
