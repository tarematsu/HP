import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const wrapper = source('spotify_webviews.inc');
const strict = source('spotify_strict_track_start_reconcile.inc');
const startup = source('spotify_startup_audio_recovery.inc');

test('Spotify startup requires target identity and target-local clock progress', () => {
  assert.match(wrapper, /#include "spotify_strict_track_start_reconcile\.inc"/);
  assert.match(
    wrapper,
    /#define kSpotifyScopedTrackReconcileScript kSpotifyStrictScopedTrackReconcileScript/,
  );

  assert.match(strict, /if \(baseResult !== true\) return baseResult/);
  assert.match(strict, /currentTrackMatchesTarget/);
  assert.match(strict, /__homePanelSpotifyStrictStartProbe/);
  assert.match(strict, /previous\.path !== targetPath/);
  assert.match(strict, /previous\.media !== activeMedia/);
  assert.match(
    strict,
    /current <= Number\(previous\.currentTime\) \+ 0\.05/,
  );
});

test('wrong-track startup is repaired instead of accepted', () => {
  assert.match(strict, /if \(!currentTrackMatchesTarget\(\)\)/);
  assert.match(strict, /pagePause\.click\(\)/);
  assert.match(strict, /__homePanelSpotifyZeroSecondRestartPath = targetPath/);
  assert.match(strict, /return 'restart'/);
});

test('strict DOM proof still feeds the existing native audio and fresh CDP gate', () => {
  assert.match(startup, /get_IsDocumentPlayingAudio\(&nativePlaying\)/);
  assert.match(
    startup,
    /SpotifyMediaStartEvidenceReady\(slot\.index, slot\.targetGeneration\)/,
  );
  assert.match(startup, /slot\.nativeAudioStartVerified = true/);
});
