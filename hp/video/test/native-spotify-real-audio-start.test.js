import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const startup = readFileSync(
  new URL('../../native/src/spotify_startup_audio_recovery.inc', import.meta.url),
  'utf8',
);

test('Spotify startup requires WebView2 and Windows Core Audio session evidence', () => {
  assert.match(startup, /get_IsDocumentPlayingAudio\(&nativePlaying\)/);
  assert.match(startup, /IAudioSessionManager2/);
  assert.match(startup, /GetSessionEnumerator/);
  assert.match(startup, /AudioSessionStateActive/);
  assert.match(startup, /windowsAudio\.querySucceeded/);
  assert.match(startup, /windowsAudio\.activeWebViewSession/);
  assert.match(startup, /msedgewebview2\.exe/);
});

test('Spotify startup does not use PCM peak as health evidence', () => {
  assert.doesNotMatch(startup, /IAudioMeterInformation/);
  assert.doesNotMatch(startup, /GetPeakValue/);
  assert.doesNotMatch(startup, /audibleWebViewSession/);
  assert.doesNotMatch(startup, /requiresPhysicalPeak/);
  assert.doesNotMatch(startup, /kSpotifyAudiblePeakFloor/);
});

test('Spotify no longer treats an unavailable native audio query as success', () => {
  assert.doesNotMatch(
    startup,
    /FAILED\(interfaceResult\)[\s\S]{0,400}nativeAudioStartVerified\s*=\s*true/,
  );
  assert.match(startup, /"Could not query" is deliberately not success/);
});

test('Spotify forces one pause-to-trusted-play restart before reload escalation', () => {
  assert.match(startup, /RequestSpotifyAudioPipelineRestart/);
  assert.match(startup, /button\.click\(\)/);
  assert.match(startup, /slot\.nativeAudioStartChecks == 2/);
  assert.match(startup, /slot\.trustedClickBlockedUntilTick = 0/);
  assert.match(startup, /SpotifyTrackStartRecoveryAction::ReloadDocument/);
  assert.match(startup, /SpotifyTrackStartRecoveryAction::RebuildSurface/);
});
