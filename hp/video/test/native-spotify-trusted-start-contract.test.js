import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const runtime = source('spotify_media_observer_runtime.inc');
const click = source('spotify_background_click.inc');

test('music play preflight is independent from observer trusted-start state', () => {
  const generation = click.indexOf('const ULONGLONG targetGeneration = slot.targetGeneration;');
  const preflight = click.indexOf('std::wstring preflight', generation);
  const dispatch = click.indexOf('DispatchSpotifyDevToolsClick', preflight);
  assert.ok(generation >= 0 && preflight > generation && dispatch > preflight);
  assert.match(click, /!CurrentMusicTrack\(slot\)/);
  assert.doesNotMatch(click, /runtime\.armTrustedStart|__homePanelSpotifyMediaObserverRuntime|ArmTimedEndObserver/);
  assert.doesNotMatch(click, /TimedSpotifyTarget/);
});

test('trusted start remains generation scoped without a wall-clock expiry', () => {
  assert.match(runtime, /const armTrustedStart = requestedGeneration =>/);
  assert.match(runtime, /requested !== generation\(\)/);
  assert.match(runtime, /state\.trustedStartKey = targetKey\(target\)/);
  assert.match(runtime, /state\.trustedStartKey !== targetKey\(target\)/);
  assert.match(runtime, /clearTrustedStart\(\)/);
  assert.doesNotMatch(runtime, /trustedStartUntil|Date\.now\(\) \+ 15000/);
  assert.match(runtime, /if \(!media\.paused\) \{[\s\S]*return 'interruption'/);
  assert.doesNotMatch(runtime, /return state\.startPosted \? 'wrong'/);
});

test('once media is adopted missing metadata preserves ownership and start state', () => {
  assert.match(runtime, /const ownsMedia = state\.targetMedia === media/);
  assert.match(runtime, /if \(!ownsMedia && \(media\.paused \|\| !consumeTrustedStart\(target\)\)\)/);
  assert.match(runtime, /state\.targetMedia = media/);
  assert.match(runtime, /state\.startPosted = true/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.doesNotMatch(runtime, /state\.started/);
});
