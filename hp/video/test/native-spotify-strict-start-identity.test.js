import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const wrapper = source('spotify_webviews.inc');
const probe = source('spotify_scoped_track_reconcile.inc');
const click = source('spotify_background_click.inc');
const musicTarget = source('spotify_music_target.inc');
const recovery = source('spotify_track_start_recovery.h');
const startup = source('spotify_startup_audio_recovery.inc');

test('Spotify startup uses one target/media probe', () => {
  assert.match(wrapper, /#include "spotify_scoped_track_reconcile\.inc"/);
  assert.doesNotMatch(wrapper, /spotify_strict_track_start_reconcile/);
  assert.doesNotMatch(wrapper, /#define kSpotifyScopedTrackReconcileScript/);
  assert.match(probe, /__homePanelSpotifySimpleStartState/);
  assert.match(probe, /__homePanelSpotifySimpleMediaProbe/);
  assert.match(probe, /current > Number\(previous\.currentTime\) \+ 0\.05/);
});

test('ads and progressing non-target media are left alone', () => {
  assert.match(probe, /advertisementVisible \|\| \(activeMedia && !targetMatches\)/);
  assert.match(probe, /return wait\(\)/);
  assert.doesNotMatch(probe, /pagePause\.click\(\)/);
  assert.doesNotMatch(probe, /ZeroSecondRestartPath/);
  assert.doesNotMatch(probe, /WrongTrackRecovery/);
});

test('normal startup issues one Play and then reloads once before skip', () => {
  assert.match(probe, /state\.playIssued/);
  assert.match(probe, /failedSampleLimit = 4/);
  assert.match(probe, /return 'startup-failure'/);
  assert.doesNotMatch(click, /NativePlayRetry/);
  assert.doesNotMatch(click, /return 'reload'|return 'recreate'/);
  assert.match(recovery, /ConsumeSpotifyStartupReload/);
  assert.match(recovery, /bool reloadIssued = false/);
  assert.doesNotMatch(recovery, /rebuildIssued|skipIssued|RebuildSurface/);
  assert.match(startup, /ConsumeSpotifyStartupReload/);
  assert.match(startup, /SkipFailedSpotifyTrack\(slot\)/);
  assert.doesNotMatch(startup, /RequestSpotifyAudioPipelineRestart/);
  assert.doesNotMatch(startup, /RebuildSurface/);
  assert.match(
    musicTarget,
    /std::wstring_view\(json\) == L"\\"startup-failure\\""/,
  );
});

test('target progress still feeds native audio and fresh CDP evidence', () => {
  assert.match(startup, /get_IsDocumentPlayingAudio\(&nativePlaying\)/);
  assert.match(
    startup,
    /SpotifyMediaStartEvidenceReady\(slot\.index, slot\.targetGeneration\)/,
  );
  assert.match(startup, /slot\.nativeAudioStartVerified = true/);
});
