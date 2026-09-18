import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const music = source('spotify_music_target.inc');
const click = source('spotify_background_click.inc');
const startup = source('spotify_startup_audio_recovery.inc');

test('trusted Spotify CDP play click uses two-second probes and five-second retry spacing', () => {
  assert.match(music, /kSpotifyPlaybackStateProbeMs = 2ULL \* 1000ULL/);
  assert.match(music, /kSpotifyCdpPlayRetryFailsafeMs = 5ULL \* 1000ULL/);
  assert.doesNotMatch(music, /kSpotifyCdpPlayConfirmWaitMs/);

  assert.match(click, /nextRecoveryTick = stateProbeAt \+ kSpotifyPlaybackStateProbeMs/);
  assert.match(click, /trustedClickBlockedUntilTick =\s*now \+ kSpotifyCdpPlayRetryFailsafeMs/);
  assert.match(click, /now-retry\.lastAttemptAt<5000/);
  assert.match(click, /retry\.count>=2/);
  assert.match(click, /EscalateSpotifyStartupFailure\(/);
  assert.match(startup, /SpotifyTrackStartRecoveryAction::ReloadDocument/);
  assert.match(startup, /slot\.webview->Reload\(\)/);
  assert.match(startup, /SpotifyTrackStartRecoveryAction::RebuildSurface/);
  assert.match(startup, /SpotifyTrackStartRecoveryAction::SkipTrack/);
  assert.match(music, /std::wstring_view\(json\) == L"\\\"restart\\\""/);
  assert.match(music, /target->trustedClickBlockedUntilTick = 0/);
});

test('playback startup uses state observation and no direct-play path', () => {
  assert.match(music, /ParseSpotifyRetryDelay\(json\)/);
  assert.match(music, /ClickSlotCssPoint\(\*target, cssX, cssY\)/);
  assert.doesNotMatch(music, /kSpotifyDirectPlayConfirmWaitMs|direct-play|DirectPlay/);
});

test('verified CSS point is dispatched without native pixel rescaling', () => {
  assert.match(click, /ParseCssPoint\(json, &verifiedX, &verifiedY\)/);
  assert.match(click, /DispatchSpotifyDevToolsClick\(\*target, verifiedX, verifiedY\)/);
  assert.match(click, /const double x = cssX;/);
  assert.match(click, /const double y = cssY;/);
  assert.doesNotMatch(click, /get_ZoomFactor|get_RasterizationScale|GetDpiForWindow|cssWidth|cssHeight/);
});
