import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const startup = source('spotify_startup_audio_recovery.inc');
const evidence = source('spotify_media_start_evidence.inc');
const foundation = source('spotify_webview_foundation.inc');
const phase = source('spotify_phase_sync.inc');
const scoped = source('spotify_scoped_track_reconcile.inc');
const wrapper = source('spotify_webviews.inc');

test('Spotify startup requires WebView2 plus slot-local CDP audio-pipeline evidence', () => {
  assert.match(startup, /get_IsDocumentPlayingAudio\(&nativePlaying\)/);
  assert.match(
    startup,
    /SpotifyMediaStartEvidenceReady\(slot\.index, slot\.targetGeneration\)/,
  );
  assert.match(evidence, /Media\.playerPropertiesChanged/);
  assert.match(evidence, /Media\.playerEventsAdded/);
  assert.match(evidence, /kAudioDecoderName/);
  assert.match(evidence, /kAudioTracks/);
  assert.match(evidence, /kPipelineStateChange/);
  assert.match(evidence, /kPlaying/);
  assert.match(evidence, /targetBaselineSequence/);
  assert.match(
    evidence,
    /playbackEventSequence <= state\.targetBaselineSequence/,
  );
  assert.match(phase, /BeginSpotifyMediaStartEvidenceGeneration/);
  assert.match(wrapper, /#include "spotify_media_start_evidence\.inc"/);
});

test('Spotify identity alone cannot confirm playback without media-clock progress', () => {
  assert.match(scoped, /const activeMedia = Array\.from\(document\.querySelectorAll\('audio, video'\)\)/);
  assert.match(scoped, /if \(targetMatches && activeMedia\) \{/);
  assert.match(scoped, /if \(targetMatches\) return failSample\(\)/);
  assert.match(scoped, /__homePanelSpotifySimpleMediaProbe/);
  assert.match(scoped, /current > Number\(previous\.currentTime\) \+ 0\.05/);
  assert.doesNotMatch(scoped, /pagePause|restartUnverifiedPause|button\.click\(\)/);
});

test('Spotify requires two spaced complete native-audio passes before startup success', () => {
  assert.match(startup, /gSpotifyNativeAudioFirstPassTicks/);
  assert.match(startup, /if \(firstPassTick == 0\) firstPassTick = now == 0 \? 1 : now/);
  assert.match(
    startup,
    /now - firstPassTick >= kSpotifyNativeAudioStartRetryMs/,
  );
  assert.match(startup, /if \(startupAudioVerified\)/);
  assert.match(startup, /else \{\s*firstPassTick = 0;\s*\}/);
  assert.match(startup, /slot\.nativeAudioStartVerified = true/);
});

test('Spotify recovery cannot reuse native or CDP proof from before an interruption', () => {
  assert.match(
    phase,
    /if \(state != SlotState::Playing && slot\.nativeAudioStartVerified\)/,
  );
  assert.match(phase, /slot\.nativeAudioStartChecks = 0/);
  assert.match(phase, /slot\.nativeAudioStartVerified = false/);
  assert.match(phase, /slot\.playbackConfirmed = false/);
  assert.match(
    phase,
    /RestartSpotifyMediaStartEvidenceWindow\(slot\.index, slot\.targetGeneration\)/,
  );
  assert.match(
    phase,
    /evidence\.targetBaselineSequence = evidence\.eventSequence/,
  );
  assert.match(phase, /evidence\.playbackEventSequence = 0/);
  assert.match(phase, /evidence\.playbackPlayerId\.clear\(\)/);
});

test('Spotify reload retry starts a fresh CDP evidence window without Pause-Play repair', () => {
  const resetAt = startup.indexOf(
    'RestartSpotifyMediaStartEvidenceWindow(slot.index, slot.targetGeneration);',
  );
  const reloadAt = startup.indexOf('slot.webview->Reload()');
  assert.notEqual(resetAt, -1);
  assert.notEqual(reloadAt, -1);
  assert.ok(resetAt < reloadAt);
  assert.doesNotMatch(startup, /RequestSpotifyAudioPipelineRestart|button\.click\(\)/);
});

test('Spotify per-slot startup no longer depends on shared Windows Core Audio or PCM', () => {
  for (const text of [startup, evidence]) {
    assert.doesNotMatch(text, /IAudioSessionManager2/);
    assert.doesNotMatch(text, /GetSessionEnumerator/);
    assert.doesNotMatch(text, /AudioSessionStateActive/);
    assert.doesNotMatch(text, /IAudioMeterInformation/);
    assert.doesNotMatch(text, /GetPeakValue/);
    assert.doesNotMatch(text, /msedgewebview2\.exe/);
  }
});

test('Spotify retains one shared UDF/environment instead of per-slot process isolation', () => {
  assert.match(foundation, /One UDF keeps the browser process family shared/);
  assert.match(foundation, /webview2-youtube-mv/);
  assert.doesNotMatch(foundation, /webview2-spotify-slot-/);
});

test('Spotify never treats unavailable native startup evidence as success', () => {
  assert.doesNotMatch(
    startup,
    /FAILED\(interfaceResult\)[\s\S]{0,400}nativeAudioStartVerified\s*=\s*true/,
  );
  assert.match(
    startup,
    /SUCCEEDED\(interfaceResult\)[\s\S]*SUCCEEDED\(stateResult\)[\s\S]*nativePlaying != FALSE[\s\S]*SpotifyMediaStartEvidenceReady/,
  );
});

test('Spotify startup failure reloads once and then skips without a restart or rebuild ladder', () => {
  assert.match(startup, /ConsumeSpotifyStartupReload/);
  assert.match(startup, /slot\.webview->Reload\(\)/);
  assert.match(startup, /SkipFailedSpotifyTrack\(slot\)/);
  assert.doesNotMatch(startup, /RequestSpotifyAudioPipelineRestart|RebuildSurface/);
  assert.doesNotMatch(startup, /mediaPipelineRecoveryPending = true/);
});
