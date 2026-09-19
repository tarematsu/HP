import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const wrapper = source('spotify_webviews.inc');
const strict = source('spotify_strict_track_start_reconcile.inc');
const musicTarget = source('spotify_music_target.inc');
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

test('advertisements and non-track interstitials are never restarted', () => {
  assert.match(strict, /const advertisementVisible = \(\) =>/);
  assert.match(
    strict,
    /advertisementVisible\(\) \|\| \(!observedTrackPath && !metadataTargetMatch\)/,
  );
  assert.match(
    strict,
    /clearWrongTrackRecovery\(\);\s*return playbackProbeMs;/,
  );
});

test('wrong-track startup restart is bounded and escalates', () => {
  assert.match(strict, /if \(!currentTrackMatchesTarget\(observedTrackPath\)\)/);
  assert.match(strict, /recovery\.samples < 2/);
  assert.match(strict, /Number\(recovery\.restarts \|\| 0\) < 1/);
  assert.match(strict, /pagePause\.click\(\)/);
  assert.match(strict, /__homePanelSpotifyZeroSecondRestartPath = targetPath/);
  assert.match(strict, /return 'restart'/);
  assert.match(strict, /return 'startup-failure'/);
  assert.match(
    musicTarget,
    /std::wstring_view\(json\) == L"\\"startup-failure\\""/,
  );
  assert.match(musicTarget, /target->trackStartRecovery\.reloadIssued/);
  assert.match(musicTarget, /EscalateSpotifyStartupFailure/);
});

test('strict DOM proof still feeds the existing native audio and fresh CDP gate', () => {
  assert.match(startup, /get_IsDocumentPlayingAudio\(&nativePlaying\)/);
  assert.match(
    startup,
    /SpotifyMediaStartEvidenceReady\(slot\.index, slot\.targetGeneration\)/,
  );
  assert.match(startup, /slot\.nativeAudioStartVerified = true/);
});
