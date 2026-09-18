import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const header = source('spotify_webviews.h');
const foundation = source('spotify_webview_foundation.inc');
const host = source('spotify_host_lifecycle.inc');
const layout = source('spotify_host_layout.inc');
const schedule = source('spotify_stagger_schedule.inc');
const phase = source('spotify_phase_sync.inc');
const rotation = source('spotify_timed_end_rotation.inc');

test('five Spotify accounts own five permanent runtime lanes', () => {
  assert.match(header, /kSpotifyActiveAccountCount = 5/);
  assert.match(header, /kSpotifyRuntimeLaneCount = kSpotifyActiveAccountCount/);
  assert.match(header, /return accountIndex < kSpotifyRuntimeLaneCount[\s\S]*static_cast<int>\(accountIndex\)/);
  assert.match(header, /SpotifyAccountShouldOwnHost/);
  assert.doesNotMatch(header, /gSpotifyRuntimeLaneAccounts/);
  assert.doesNotMatch(header, /gSpotifyInactiveAccountIndex/);
  assert.match(host, /for \(Slot& slot : slots_\)[\s\S]*SpotifyAccountShouldOwnHost\(slot\.index\)[\s\S]*CreateHost\(slot\)/);
});

test('scheduler keeps all five Spotify accounts eligible', () => {
  assert.match(schedule, /if \(!SpotifyAccountShouldOwnHost\(index\)\) continue/);
  assert.match(phase, /if \(!SpotifyAccountShouldOwnHost\(i\)\) continue/);
  assert.match(header, /return accountIndex < kSpotifyActiveAccountCount/);
});

test('finishing a track cycle keeps the same WebView alive', () => {
  assert.match(
    rotation,
    /\+\+slot\.timedRotationCycle;[\s\S]*slot\.timedRotationPosition = 0;[\s\S]*PrepareTimedRotationCycle\(slot\)/,
  );
  assert.doesNotMatch(rotation, /gSpotifyInactiveAccountIndex/);
  assert.doesNotMatch(rotation, /gSpotifyRuntimeLaneAccounts/);
  assert.doesNotMatch(rotation, /CloseSlot\(slot\)/);
  assert.doesNotMatch(rotation, /CreateHost\(nextSlot\)/);
});

test('S1 through S5 stay pinned to logical Spotify account ids', () => {
  assert.match(foundation, /S1-S5 => 0-4/);
  assert.match(foundation, /gSpotifyAudioOutputAccountIndex/);
  assert.match(foundation, /gSpotifyMonitorForegroundAccountIndex/);
  assert.match(foundation, /SpotifyRuntimeLaneForControlAccount/);
  assert.match(layout, /SpotifyRuntimeLaneForControlAccount\([\s\S]*gSpotifyMonitorForegroundAccountIndex/);
  assert.match(header, /return accountIndex < kSpotifyRuntimeLaneCount[\s\S]*static_cast<int>\(accountIndex\)/);
});

test('scheduler host is reassigned when a host is closed for recovery or shutdown', () => {
  assert.match(host, /wasSchedulerHost/);
  assert.match(host, /for \(const Slot& candidate : slots_\)/);
  assert.match(host, /schedulerHost_\.store\(candidate\.hostWindow/);
  assert.match(host, /schedulerHost_\.load\(std::memory_order_acquire\) == hwnd/);
  assert.doesNotMatch(host, /message == kSpotifySchedulerMessage && slot->index == 0/);
});
