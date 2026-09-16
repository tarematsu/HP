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

test('four Spotify accounts share exactly three runtime lanes', () => {
  assert.match(header, /kSpotifyRuntimeLaneCount = 3/);
  assert.match(header, /gSpotifyRuntimeLaneAccounts = \{[\s\S]*0, 1, 2/);
  assert.match(header, /gSpotifyInactiveAccountIndex = 3/);
  assert.match(header, /SpotifyRuntimeLaneForAccount/);
  assert.match(header, /SpotifyAccountShouldOwnHost/);
  assert.doesNotMatch(foundation, /gSpotifyRuntimeLaneAccounts =/);
  assert.match(host, /ResetSpotifyRuntimeLanes\(\)/);
  assert.match(host, /SpotifyAccountShouldOwnHost\(slot\.index\)[\s\S]*CreateHost\(slot\)/);
});

test('scheduler never recreates the waiting fourth account', () => {
  assert.match(schedule, /if \(!SpotifyAccountShouldOwnHost\(index\)\) continue/);
  assert.match(phase, /if \(!SpotifyAccountShouldOwnHost\(i\)\) continue/);
});

test('a completed account leaves its lane and the waiter enters that same lane', () => {
  assert.match(rotation, /const int completedLane = SpotifyRuntimeLaneForAccount\(slot\.index\)/);
  assert.match(rotation, /const size_t nextAccountIndex = gSpotifyInactiveAccountIndex/);
  assert.match(rotation, /CloseSlot\(slot\)/);
  assert.match(rotation, /gSpotifyRuntimeLaneAccounts\[static_cast<size_t>\(completedLane\)\] =[\s\S]*nextAccountIndex/);
  assert.match(rotation, /gSpotifyInactiveAccountIndex = completedAccountIndex/);
  assert.match(rotation, /CreateHost\(nextSlot\)/);
  assert.match(rotation, /slot\.timedRotationCycle = completedCycles/);
});

test('B C D foreground and audio choices follow runtime lanes rather than account ids', () => {
  assert.match(layout, /SpotifyRuntimeLaneForAccount\(i\) == monitorForegroundSlot_/);
  assert.match(foundation, /const int runtimeLane = accountIndex >= 0[\s\S]*SpotifyRuntimeLaneForAccount/);
  assert.match(foundation, /runtimeLane != gSpotifyAudioOutputSlot/);
});

test('scheduler host is reassigned when any logical account is swapped out', () => {
  assert.match(host, /wasSchedulerHost/);
  assert.match(host, /for \(const Slot& candidate : slots_\)/);
  assert.match(host, /schedulerHost_\.store\(candidate\.hostWindow/);
  assert.match(host, /schedulerHost_\.load\(std::memory_order_acquire\) == hwnd/);
  assert.doesNotMatch(host, /message == kSpotifySchedulerMessage && slot->index == 0/);
});
