import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const episode = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const playbackPolicy = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url);
const routingKeys = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_ad_guard.inc', import.meta.url), 'utf8');

test('TVer event policy never owns program playback recovery', () => {
  assert.doesNotMatch(episode, /video\.play\s*\(/);
  assert.doesNotMatch(episode, /playButton\.click\s*\(/);
  assert.match(episode, /if \(video\.paused && !video\.ended\) recoveryFlags\.push\('paused'\)/);
  assert.match(episode, /wakeNative\('recovery:' \+ recoveryFlags\.join\('\+'\)/);
});

test('paused TVer playback recovery is idempotent and never toggles the video surface', () => {
  assert.match(playbackPolicy, /if \(video\.paused && !video\.ended\)/);
  assert.match(playbackPolicy, /const pending = video\.play\(\)/);
  assert.match(playbackPolicy, /pending\.catch\(\(\) => \{\}\)/);
  assert.doesNotMatch(playbackPolicy, /point\(video\)/);
  assert.doesNotMatch(playbackPolicy, /video\.pause\s*\(/);
  assert.doesNotMatch(playbackPolicy, /__homePanelTverResumeBlocked/);
});

test('TVer fullscreen recovery only targets an explicit fullscreen control once', () => {
  assert.match(playbackPolicy, /return fullscreenButton \? point\(fullscreenButton\) : null/);
  assert.match(playbackPolicy, /if \(state && state\.fullscreenDirty === false\) return null/);
  assert.doesNotMatch(playbackPolicy, /fullscreenButton \? point\(fullscreenButton\) : point\(video\)/);
});

test('legacy TVer static module contains routing keys only', () => {
  assert.match(routingKeys, /homepanel-tver-loop-routing-key/);
  assert.match(routingKeys, /homepanel-tver-watchdog-routing-key/);
  assert.doesNotMatch(routingKeys, /querySelectorAll|MutationObserver|video\.play/);
});
