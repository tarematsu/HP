import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const foundation = source('spotify_webview_foundation.inc');
const host = source('spotify_host_lifecycle.inc');
const controller = source('spotify_controller_lifecycle.inc');
const schedule = source('spotify_stagger_schedule.inc');
const rotation = source('spotify_timed_end_rotation.inc');

test('ten starts as the single live member of the ten/hinata pair', () => {
  assert.match(foundation, /kSpotifyTenSlotIndex = 1/);
  assert.match(foundation, /kSpotifyHinataSlotIndex = 3/);
  assert.match(foundation, /gSpotifyAlternatingActiveSlot = kSpotifyTenSlotIndex/);
  assert.match(foundation, /SpotifySlotShouldOwnHost/);
  assert.match(host, /gSpotifyAlternatingActiveSlot = kSpotifyTenSlotIndex/);
  assert.match(host, /SpotifySlotShouldOwnHost\(slot\.index\)[\s\S]*CreateHost\(slot\)/);
});

test('scheduler never creates or reconciles the inactive paired slot', () => {
  assert.match(schedule, /if \(!SpotifySlotShouldOwnHost\(index\)\) continue/);
  assert.match(schedule, /if \(!slot\.hostWindow \|\| !IsWindow\(slot\.hostWindow\)\)[\s\S]*CreateHost\(slot\)/);
});

test('one completed cycle destroys the current WebView and activates the peer', () => {
  assert.match(rotation, /if \(IsSpotifyAlternatingPairSlot\(slot\.index\)/);
  assert.match(rotation, /slot\.index == kSpotifyTenSlotIndex[\s\S]*kSpotifyHinataSlotIndex[\s\S]*kSpotifyTenSlotIndex/);
  assert.match(rotation, /CloseSlot\(slot\)/);
  assert.match(rotation, /gSpotifyAlternatingActiveSlot = nextSlotIndex/);
  assert.match(rotation, /CreateHost\(nextSlot\)/);
  assert.match(rotation, /ArmRobustScheduler\(\)/);
});

test('alternation preserves profile identity and advances random cycle seeds', () => {
  assert.match(controller, /target->index \+ kSpotifyProfileFirstAccountNumber/);
  assert.match(rotation, /const ULONGLONG completedCycles = slot\.timedRotationCycle/);
  assert.match(rotation, /slot\.timedRotationCycle = completedCycles/);
  assert.match(rotation, /if \(!IsSpotifyAlternatingPairSlot\(slot\.index\)\) slot\.timedRotationCycle = 0/);
});
