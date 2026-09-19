import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const stationhead = source('sh_track_boundary_message_policy.h');
const spotifyHeader = source('spotify_webviews.h');
const spotifyClick = source('spotify_background_click.inc');
const spotifyController = source('spotify_controller_lifecycle.inc');
const spotifyPhase = source('spotify_phase_sync.inc');
const spotifyHost = source('spotify_host_lifecycle.inc');
const spotifyTrackRecovery = source('spotify_track_start_recovery.h');
const spotifyStartup = source('spotify_startup_audio_recovery.inc');

test('Stationhead silence recovery is one bounded native ladder', () => {
  assert.match(stationhead, /enum class StationheadAudioRecoveryStage/);
  for (const stage of ['Idle', 'LightRepair', 'Reload', 'Rebuild', 'Fallback']) {
    assert.match(stationhead, new RegExp(`\\b${stage}\\b`));
  }
  assert.match(stationhead, /EscalateAudioLossRecovery\(nowMs\)/);
  assert.match(stationhead, /kLightRepairScript/);
  assert.match(stationhead, /AttemptNativeStartClick\(nowMs\)/);
  assert.match(stationhead, /NavigateCurrentUrl\(nowMs, L"audio-loss recovery reload"\)/);
  assert.match(
    stationhead,
    /ScheduleRecreate\(L"Stationhead silence recovery WebView rebuild", 1'000\)/,
  );
  assert.match(stationhead, /previousLifecycle != createCallbackAlive_/);
  assert.match(stationhead, /BeginAudioLossAuthProbe\(nowMs\)/);
  assert.match(
    stationhead,
    /SetManagedPlaybackFallback\([\s\S]*true,[\s\S]*remained silent after bounded recovery/,
  );

  const escalationAt = stationhead.indexOf('EscalateAudioLossRecovery(nowMs);');
  const healthPollAt = stationhead.indexOf('PollPeriodicAudioHealth(nowMs);');
  assert.ok(escalationAt >= 0 && healthPollAt > escalationAt);
});

test('Stationhead ladder resets on real audio and cannot restart after fallback', () => {
  assert.match(stationhead, /StationheadAudioRecoverySettleMs\(\) noexcept[\s\S]*return 15'000/);
  assert.match(
    stationhead,
    /if \(audioPlaying_\.load\(std::memory_order_relaxed\)\) \{[\s\S]*ResetAudioLossEscalation\(\);/,
  );
  assert.match(stationhead, /audioLossRecoveryStage_ = RecoveryStage::Fallback/);
  assert.match(stationhead, /managedPlaybackFallbackActive_/);
  assert.match(stationhead, /spotifyAuthorization_ \|\| loginRequired_/);
  assert.match(stationhead, /ResetMediaRecoveryEpisode\(mediaRecoveryEpisode_, 1\)/);
  assert.doesNotMatch(stationhead, /audioLossEscalationStage_/);
  assert.doesNotMatch(stationhead, /NextMediaRecoveryAction/);
});

test('Spotify normal startup reloads once and then skips', () => {
  assert.match(spotifyHeader, /SpotifyTrackStartRecovery trackStartRecovery\{\}/);
  assert.match(spotifyHeader, /bool nativeAudioStartVerified = false/);
  assert.match(spotifyPhase, /BeginSpotifyTrackStartRecovery/);
  assert.match(spotifyHost, /slot\.trackStartRecovery = \{\}/);
  assert.match(spotifyTrackRecovery, /bool reloadIssued = false/);
  assert.match(spotifyTrackRecovery, /ConsumeSpotifyStartupReload/);
  assert.doesNotMatch(spotifyTrackRecovery, /rebuildIssued|skipIssued|RebuildSurface/);
  assert.match(spotifyStartup, /ConsumeSpotifyStartupReload/);
  assert.match(spotifyStartup, /slot\.webview->Reload\(\)/);
  assert.match(spotifyStartup, /SkipFailedSpotifyTrack\(slot\)/);
  assert.doesNotMatch(spotifyStartup, /mediaPipelineRecoveryPending = true/);
  assert.doesNotMatch(spotifyStartup, /RebuildSurface/);
  assert.doesNotMatch(spotifyClick, /EscalateSpotifyStartupFailure/);
});

test('Spotify explicit full rebuild preserves current target and rotation', () => {
  const start = spotifyController.indexOf(
    'void SpotifyWebViews::RebuildPlaybackSurface');
  const end = spotifyController.indexOf(
    'void SpotifyWebViews::CreateController', start);
  assert.ok(start >= 0 && end > start);
  const rebuild = spotifyController.slice(start, end);

  assert.doesNotMatch(rebuild, /slot\.targetGeneration = 0/);
  assert.doesNotMatch(rebuild, /slot\.timedRotationPosition = 0/);
  assert.doesNotMatch(rebuild, /slot\.timedRotationActive = false/);
  assert.match(rebuild, /slot\.nextRecoveryTick = GetTickCount64\(\)/);
  assert.match(spotifyStartup, /AdvanceTimedRotationSlot\(slot\)/);
});
