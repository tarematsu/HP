import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_audio_loss_policy.h', import.meta.url),
  'utf8',
);
const audioLoss = readFileSync(
  new URL('../../native/src/sh_audio_loss.cpp', import.meta.url),
  'utf8',
);

test('fallback URL switching requires native audio-loss validation', () => {
  const managed = audioLoss.slice(
    audioLoss.indexOf('void StationheadPlayer::SetManagedPlaybackFallback'),
    audioLoss.indexOf('void StationheadPlayer::EvaluateAudioLossRecovery'),
  );
  assert.match(managed, /audioLossStartedAt_\.ElapsedMilliseconds\(\)/);
  assert.match(
    managed,
    /StationheadAudioLossCanFallback\(\s*audioLossProbeComplete_, audioLossAuthUiDetected_, stoppedForMs\)/,
  );
  assert.match(managed, /ignored fallback request before native audio-loss validation/);
  assert.ok(
    managed.indexOf('StationheadAudioLossCanFallback') <
      managed.indexOf('SetPlaybackFallback(true, reason)'),
  );
});

test('a silent fallback returns to the canonical station', () => {
  assert.match(policy, /kStationheadFallbackSilentRetryMs = 30'000/);
  assert.match(
    policy,
    /kStationheadFallbackSilentRetryMs > kStationheadFallbackMinimumDwellMs/,
  );
  const evaluate = audioLoss.slice(
    audioLoss.indexOf('void StationheadPlayer::EvaluateAudioLossRecovery'),
  );
  assert.match(evaluate, /!AudioPlaying\(\)/);
  assert.match(evaluate, /fallbackElapsedMs >= kStationheadFallbackSilentRetryMs/);
  assert.match(evaluate, /fallback remained silent; retrying canonical station/);
  assert.match(evaluate, /audioLossPlaybackObserved_ = false/);
});
