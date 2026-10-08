import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const stationhead = source('sh_track_boundary_message_policy.h');

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

