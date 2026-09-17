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

test('Stationhead escalates silence through reload, trusted click, WebView rebuild, then fallback', () => {
  assert.match(stationhead, /EscalateAudioLossRecovery\(nowMs\)/);
  assert.match(stationhead, /audioLossEscalationStage_ = 1/);
  assert.match(stationhead, /NavigateCurrentUrl\(nowMs, L"audio-loss recovery reload"\)/);
  assert.match(stationhead, /AttemptNativeStartClick\(nowMs\)/);
  assert.match(stationhead, /audioLossEscalationStage_ = 2/);
  assert.match(
    stationhead,
    /ScheduleRecreate\([\s\S]*audio still silent after page reload; rebuilding playback WebView/,
  );
  assert.match(stationhead, /previousLifecycle != createCallbackAlive_/);
  assert.match(stationhead, /BeginAudioLossAuthProbe\(nowMs\)/);
  assert.match(
    stationhead,
    /SetManagedPlaybackFallback\([\s\S]*true,[\s\S]*page reload and WebView rebuild/,
  );

  const escalationAt = stationhead.indexOf('EscalateAudioLossRecovery(nowMs);');
  const healthPollAt = stationhead.indexOf('PollPeriodicAudioHealth(nowMs);');
  assert.ok(escalationAt >= 0 && healthPollAt > escalationAt);
});

test('Stationhead escalation is bounded and resets on real audio', () => {
  assert.match(stationhead, /StationheadAudioEscalationSettleMs\(\)[\s\S]*return 15'000/);
  assert.match(
    stationhead,
    /if \(audioPlaying_\.load\(std::memory_order_relaxed\)\) \{[\s\S]*ResetAudioLossEscalation\(\);/,
  );
  assert.match(stationhead, /audioLossEscalationStage_ = 3/);
  assert.match(stationhead, /managedPlaybackFallbackActive_/);
  assert.match(stationhead, /spotifyAuthorization_ \|\| loginRequired_/);
});

test('Spotify escalates trusted Play recovery through one reload and one full rebuild per target', () => {
  assert.match(spotifyHeader, /ULONGLONG playRecoveryRecreateGeneration = 0/);
  assert.match(spotifyPhase, /slot\.playRecoveryRecreateGeneration = 0/);
  assert.match(spotifyHost, /slot\.playRecoveryRecreateGeneration = 0/);
  assert.match(spotifyClick, /const recreateUsed=/);
  assert.match(spotifyClick, /if\(!recreateUsed\)return 'recreate'/);
  assert.match(spotifyClick, /playRecoveryRecreateGeneration != targetGeneration/);
  assert.match(spotifyClick, /playRecoveryRecreateGeneration = targetGeneration/);
  assert.match(spotifyClick, /RebuildPlaybackSurface\(\*target\)/);
  assert.match(spotifyController, /slot\.webview\.Reset\(\)/);
  assert.match(spotifyController, /slot\.controller->Close\(\)/);
  assert.match(spotifyController, /slot\.environment\.Reset\(\)/);
  assert.match(spotifyController, /SetSlotState\(slot, SlotState::NotCreated\)/);
});

test('Spotify full rebuild preserves current target and rotation instead of advancing', () => {
  const start = spotifyController.indexOf(
    'void SpotifyWebViews::RebuildPlaybackSurface');
  const end = spotifyController.indexOf(
    'void SpotifyWebViews::CreateController', start);
  assert.ok(start >= 0 && end > start);
  const rebuild = spotifyController.slice(start, end);

  assert.doesNotMatch(rebuild, /slot\.targetGeneration = 0/);
  assert.doesNotMatch(rebuild, /slot\.timedRotationPosition = 0/);
  assert.doesNotMatch(rebuild, /slot\.timedRotationActive = false/);
  assert.match(rebuild, /const ULONGLONG now = GetTickCount64\(\)/);
  assert.match(rebuild, /slot\.nextRecoveryTick = now/);
});
