import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const wrapper = source('spotify_webviews.inc');
const policy = source('spotify_runtime_policy.inc');
const phase = source('spotify_phase_sync.inc');
const controller = source('spotify_controller_lifecycle.inc');
const layout = source('spotify_host_layout.inc');
const host = source('spotify_host_lifecycle.inc');

test('Spotify uses LOW memory immediately after confirmed playback', () => {
  assert.match(wrapper, /#include "spotify_runtime_policy\.inc"/);
  assert.match(
    phase,
    /slot\.state = state;[\s\S]*state == SlotState::Playing[\s\S]*COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW[\s\S]*COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL/,
  );
  assert.doesNotMatch(phase, /kSpotifyLowMemoryStablePlaybackMs/);
  assert.match(
    phase,
    /state == SlotState::NotCreated \|\| state == SlotState::Authenticating \|\|\s*state == SlotState::Playing[\s\S]*slot\.nextRecoveryTick = 0/,
  );
  assert.match(phase, /MarkSlotRecovering[\s\S]*SetSlotState\(slot, SlotState::Recovering\)/);
});

test('Spotify keeps a 720x480 controller viewport except on login pages', () => {
  assert.match(policy, /kSpotifyInternalViewportWidth = 720/);
  assert.match(policy, /kSpotifyInternalViewportHeight = 480/);
  assert.match(
    policy,
    /if \(authentication && hostWindow && IsWindow\(hostWindow\)\)[\s\S]*GetClientRect\(hostWindow, &client\)[\s\S]*return client;[\s\S]*return SpotifyFixedViewportBounds\(\)/,
  );
  assert.match(controller, /SpotifyControllerBounds\(target->hostWindow, target->loginPage\)/);
  assert.match(controller, /SpotifyControllerBounds\(target->hostWindow, loginPage\)/);
  assert.match(layout, /SpotifyControllerBounds\(slot\.hostWindow, loginPage\)/);
  assert.match(host, /SpotifyControllerBounds\(hwnd, slot->loginPage\)/);
});
