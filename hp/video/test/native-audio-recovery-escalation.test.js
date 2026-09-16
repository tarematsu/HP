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
  assert.match(spotifyClick, /target->webview\.Reset\(\)/);
  assert.match(spotifyClick, /target->controller->Close\(\)/);
  assert.match(spotifyClick, /target->environment\.Reset\(\)/);
  assert.match(spotifyClick, /SetSlotState\(\*target, SlotState::NotCreated\)/);
});

test('Spotify full rebuild preserves current target and rotation instead of advancing', () => {
  const start = spotifyClick.indexOf('std::wstring_view(json) == L"\\\"recreate\\\""');
  const end = spotifyClick.indexOf('double verifiedX', start);
  assert.ok(start >= 0 && end > start);
  const rebuild = spotifyClick.slice(start, end);

  assert.doesNotMatch(rebuild, /target->targetGeneration = 0/);
  assert.doesNotMatch(rebuild, /target->timedRotationPosition = 0/);
  assert.doesNotMatch(rebuild, /target->timedRotationActive = false/);
  assert.match(rebuild, /target->nextRecoveryTick = GetTickCount64\(\)/);
});
