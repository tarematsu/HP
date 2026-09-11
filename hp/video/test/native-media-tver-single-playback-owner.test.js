import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const episode = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url), 'utf8');
const playbackPolicy = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url), 'utf8');
const routingKeys = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_ad_guard.inc', import.meta.url), 'utf8');

test('TVer event policy never owns program playback recovery', () => {
  assert.doesNotMatch(episode, /video\.play\s*\(/);
  assert.doesNotMatch(episode, /playButton\.click\s*\(/);
  assert.match(episode, /if \(video\.paused && !video\.ended\) wakeNative\(\)/);
});

test('paused TVer playback is recovered only by the trusted watchdog', () => {
  assert.match(playbackPolicy, /if \(video\.paused && !video\.ended\)/);
  assert.match(playbackPolicy, /const pending = video\.play\(\)/);
  assert.match(playbackPolicy, /video\.__homePanelTverResumeBlocked/);
  assert.match(playbackPolicy, /return playButton \? point\(playButton\) : null/);
  assert.doesNotMatch(playbackPolicy, /video\.pause\s*\(/);
});

test('legacy TVer static module contains routing keys only', () => {
  assert.match(routingKeys, /homepanel-tver-loop-routing-key/);
  assert.match(routingKeys, /homepanel-tver-watchdog-routing-key/);
  assert.doesNotMatch(routingKeys, /querySelectorAll|MutationObserver|video\.play/);
});
