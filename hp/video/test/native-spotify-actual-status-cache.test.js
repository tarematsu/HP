import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync(
  new URL('../../native/src/spotify_media_observer_runtime.inc', import.meta.url), 'utf8');
const events = readFileSync(
  new URL('../../native/src/spotify_media_observer_events.inc', import.meta.url), 'utf8');
const status = readFileSync(
  new URL('../../native/src/spotify_process_title_status.inc', import.meta.url), 'utf8');

test('Spotify status cache is populated only from confirmed actual playback identity', () => {
  assert.match(runtime, /actualTrackTitle: ''/);
  assert.match(runtime, /actualTrackPath: ''/);
  assert.match(runtime, /const currentTrack = \(\) =>/);
  assert.match(runtime, /nowPlayingRoots\(\)/);
  assert.match(runtime, /a\[href\*="\/track\/"\]/);
  assert.match(runtime, /displayTitle/);
  assert.match(runtime, /source: 'now-playing-dom'/);
  assert.match(runtime, /source: 'media-session'/);
  assert.match(runtime, /displayTitle: ''/);
  assert.match(
    runtime,
    /if \(identity\.source === 'now-playing-dom' && identity\.displayTitle\) \{[\s\S]*state\.actualTrackTitle = identity\.displayTitle/,
  );
  assert.doesNotMatch(runtime, /actualTrackTitle\s*=\s*(?:target|window\.__homePanelSpotifyNativeTarget)/);
  assert.match(runtime, /clearActualTrack\(\)/);
});

test('Spotify status keeps probing only until the actual title is captured', () => {
  assert.match(
    events,
    /event\.type === 'timeupdate'[\s\S]*state\.startPosted[\s\S]*state\.targetMedia === event\.target[\s\S]*state\.actualTrackTitle/,
  );
  assert.match(events, /state\.actualTrackTitle = ''/);
  assert.match(events, /state\.actualTrackPath = ''/);
});

test('one-minute phased poll reads confirmed cache and gated media session before live DOM', () => {
  assert.match(status, /const state = runtime && runtime\.state/);
  assert.match(status, /state && state\.actualTrackTitle/);
  const cacheRead = status.indexOf('state.actualTrackTitle');
  const mediaSessionRead = status.indexOf('navigator.mediaSession');
  const firstDomRead = status.indexOf("document.querySelector('[data-testid=\"now-playing-widget\"]')");
  assert.ok(cacheRead >= 0 && mediaSessionRead > cacheRead && firstDomRead > mediaSessionRead);

  assert.match(status, /const ownedMedia = state && state\.targetMedia/);
  assert.match(status, /state && state\.startPosted && ownedMedia/);
  assert.match(status, /!ownedMedia\.paused && !ownedMedia\.ended/);
  assert.match(status, /Number\.isFinite\(currentTime\) && currentTime > 0/);
  assert.match(status, /if \(confirmedPlayback\) \{[\s\S]*navigator\.mediaSession[\s\S]*metadata\.title/);

  assert.match(status, /kSpotifyProcessTitlePollMs = 60ULL \* 1000ULL/);
  assert.match(status, /kSpotifyProcessTitlePollPhaseMs == 12ULL \* 1000ULL/);
  assert.match(status, /size_t selected = slots_\.size\(\)/);
  assert.doesNotMatch(status, /__homePanelSpotifyNativeTarget/);
  assert.doesNotMatch(status, /document\.title/);
});
