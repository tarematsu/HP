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

test('Spotify no longer treats unavailable startup evidence as success', () => {
  assert.doesNotMatch(
    startup,
    /FAILED\(interfaceResult\)[\s\S]{0,400}nativeAudioStartVerified\s*=\s*true/,
  );
  assert.match(startup, /deliberately fail-closed/);
});

test('Spotify forces one pause-to-trusted-play restart before reload escalation', () => {
  assert.match(startup, /RequestSpotifyAudioPipelineRestart/);
  assert.match(startup, /button\.click\(\)/);
  assert.match(startup, /slot\.nativeAudioStartChecks == 2/);
  assert.match(startup, /slot\.trustedClickBlockedUntilTick = 0/);
  assert.match(startup, /SpotifyTrackStartRecoveryAction::ReloadDocument/);
  assert.match(startup, /SpotifyTrackStartRecoveryAction::RebuildSurface/);
});
