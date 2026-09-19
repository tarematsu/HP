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

test('Spotify Pause UI alone cannot confirm playback without media-clock evidence', () => {
  assert.match(scoped, /const recordUnverifiedPause = \(button, media\) =>/);
  assert.match(scoped, /if \(!media\) return recordUnverifiedPause\(button, null\)/);
  assert.match(
    scoped,
    /if \(!Number\.isFinite\(current\) \|\| current < 0\)[\s\S]*recordUnverifiedPause\(button, media\)/,
  );
  assert.match(scoped, /stagnantSamples < stalledObservationLimit/);
  assert.match(scoped, /return restartUnverifiedPause\(button\)/);
  assert.doesNotMatch(
    scoped,
    /if \(!media\)[\s\S]{0,160}return 'confirmed'/,
  );
});

test('Spotify requires two spaced complete native-audio passes before startup success', () => {
  assert.match(startup, /gSpotifyNativeAudioFirstPassTicks/);
  assert.match(startup, /if \(firstPassTick == 0\) firstPassTick = now == 0 \? 1 : now/);
  assert.match(
    startup,
    /now - firstPassTick >= kSpotifyNativeAudioStartRetryMs/,
  );
  const firstPassAt = startup.indexOf('if (firstPassTick == 0) firstPassTick');
  const verifiedAt = startup.indexOf('slot.nativeAudioStartVerified = true');
  assert.notEqual(firstPassAt, -1);
  assert.notEqual(verifiedAt, -1);
  assert.ok(verifiedAt < firstPassAt || startup.includes('firstPassTick != 0'));
  assert.match(startup, /Any failed sample breaks the consecutive-success requirement/);
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

test('Spotify pause-to-trusted-play recovery also demands a fresh CDP playback event', () => {
  const resetAt = startup.indexOf(
    'RestartSpotifyMediaStartEvidenceWindow(slot.index, slot.targetGeneration);',
  );
  const restartAt = startup.indexOf(
    'RequestSpotifyAudioPipelineRestart(slot.webview.Get());',
  );
  assert.notEqual(resetAt, -1);
  assert.notEqual(restartAt, -1);
  assert.ok(resetAt < restartAt);
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
