import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const header = source('spotify_webviews.h');
const network = source('spotify_network_block.inc');
const host = source('spotify_host_lifecycle.inc');
const lifecycle = source('renderer_lifecycle.cpp');
const schedule = source('spotify_stagger_schedule.inc');

test('Spotify network block destroys all configured WebView/controller slots', () => {
  assert.match(header, /void SetNetworkBlocked\(bool blocked\) noexcept/);
  assert.match(header, /bool networkBlocked_ = false/);
  assert.match(network, /alive_->store\(false, std::memory_order_release\)/);
  assert.match(network, /for \(Slot& slot : slots_\) CloseSlot\(slot\)/);
});

test('Spotify unmute recreates only the three active runtime accounts', () => {
  assert.match(network, /alive_ = std::make_shared<std::atomic<bool>>\(true\)/);
  assert.match(network, /SpotifyAccountShouldOwnHost\(slot\.index\)[\s\S]*CreateHost\(slot\)/);
  assert.doesNotMatch(network, /CreateController\(slots_\[0\]\)/);
  assert.match(host, /slot\.timedRotationActive = false/);
  assert.match(host, /slot\.timedCompletionDeadlineTick = 0/);
  assert.match(host, /slot\.nextRecoveryTick = 0/);
  assert.match(host, /\+\+slot\.asyncEpoch/);
  assert.match(host, /\+\+slot\.pageEpoch/);
  assert.match(host, /slot\.asyncWork = AsyncWork::None/);
  assert.match(host, /slot\.trustedClickBlockedUntilTick = 0/);
  assert.match(host, /slot\.timedRotationCycle = 0/);
  assert.match(host, /slot\.timedRotationPosition = 0/);
  assert.match(host, /slot\.targetGeneration = 0/);
  assert.doesNotMatch(network + header, /timedInterruptionStartTick|reconcileInFlight|lastTimedReconcileTick|TimedSpotifyTarget/);
  assert.match(network, /StartAutonomousSchedule\(GetTickCount64\(\)\)/);
  assert.match(schedule, /kSpotifyInitialStartDelayMs = 0/);
});

test('global media mute remains the only media-to-Spotify state coupling', () => {
  assert.match(lifecycle, /gSpotifyMediaNetworkBlocked = false/);
  assert.match(lifecycle, /SetSpotifyMediaNetworkBlocked\(bool blocked\)[\s\S]*SetNetworkBlocked\(blocked\)/);
  assert.match(lifecycle, /void SetSpotifyMediaPhase\(bool\) noexcept/);
  assert.doesNotMatch(lifecycle, /gSpotifyTverPhase/);
});

test('unmute restarts autonomous cloud rotation without a media-phase wait', () => {
  assert.match(schedule, /if \(!slot\.timedRotationActive\)/);
  assert.match(schedule, /InitializeTimedRotationSlot\(slot\)/);
  assert.match(schedule, /StartAutonomousSchedule/);
  assert.doesNotMatch(schedule, /gSpotifyTverPhase/);
});
