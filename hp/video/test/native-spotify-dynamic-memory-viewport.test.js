import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const wrapper = source('spotify_webviews.inc');
const policy = source('spotify_runtime_policy.inc');
const phase = source('spotify_phase_sync.inc');
const resourceMode = source('spotify_permanent_resource_mode.h');
const controller = source('spotify_controller_lifecycle.inc');
const layout = source('spotify_host_layout.inc');
const host = source('spotify_host_lifecycle.inc');

test('Spotify keeps the WebView2 memory target permanently LOW', () => {
  assert.match(wrapper, /#include "spotify_runtime_policy\.inc"/);
  assert.doesNotMatch(
    policy,
    /put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)/,
  );
  assert.match(phase, /#include "spotify_permanent_resource_mode\.h"/);
  assert.match(phase, /ApplySpotifyPermanentResourceMode\(slot\)/);
  assert.match(resourceMode, /put_MemoryUsageTargetLevel/);
  assert.match(resourceMode, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.doesNotMatch(resourceMode, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL/);
  assert.match(
    phase,
    /if \(state == SlotState::Playing\)[\s\S]*slot\.nativeAudioStartVerified[\s\S]*slot\.nextRecoveryTick = 0[\s\S]*kSpotifyNativeAudioStartRetryMs/,
  );
  assert.match(phase, /MarkSlotRecovering[\s\S]*SetSlotState\(slot, SlotState::Recovering\)/);
});

test('Spotify keeps a 320x160 controller viewport except on login pages', () => {
  assert.match(policy, /kSpotifyInternalViewportWidth = 320/);
  assert.match(policy, /kSpotifyInternalViewportHeight = 160/);
  assert.match(
    policy,
    /if \(authentication && hostWindow && IsWindow\(hostWindow\)\)[\s\S]*GetClientRect\(hostWindow, &client\)[\s\S]*return client;[\s\S]*return SpotifyFixedViewportBounds\(\)/,
  );
  assert.match(controller, /SpotifyControllerBounds\(target->hostWindow, target->loginPage\)/);
  assert.match(controller, /SpotifyControllerBounds\(target->hostWindow, loginPage\)/);
  assert.match(layout, /SpotifyControllerBounds\(slot\.hostWindow, loginPage\)/);
  assert.match(host, /SpotifyControllerBounds\(hwnd, slot->loginPage\)/);
});
