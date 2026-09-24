import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/renderer_panels/${name}`, import.meta.url), 'utf8');
const runtime = source('media_tver_control_recovery.inc');
const episode = source('media_tver_episode_loop_policy.inc');
const watchdog = source('media_tver_playback_policy.inc');

test('TVer uses one YouTube-style control recovery runtime', () => {
  assert.match(episode, /media_tver_control_recovery\.inc/);
  assert.match(episode, /kNativeMediaTverControlRecoveryScript/);
  assert.match(watchdog, /kNativeMediaTverControlRecoveryScript/);
  assert.doesNotMatch(episode, /media_tver_episode_loop_policy_part/);
  assert.doesNotMatch(watchdog, /media_tver_playback_policy_(?:guard|main1|main2)\.inc/);
});

test('TVer fullscreen uses a direct trusted video-corner tap', () => {
  assert.match(runtime, /const requestFullscreen = \(\) =>/);
  assert.match(runtime, /video\.getBoundingClientRect/);
  assert.match(runtime, /rect\.right - 12/);
  assert.match(runtime, /rect\.bottom - 12/);
  assert.match(runtime, /state\.fullscreenCornerTapAt/);
  assert.match(runtime, /document\.fullscreenElement/);
  assert.doesNotMatch(runtime, /homepanel:tver-fullscreen-key|fullscreenControl/);
  assert.doesNotMatch(runtime, /data-homepanel-tver-fill|homepanel-tver-viewport-fill/);
});

test('TVer ad skip is event-driven and uses the shared trusted-click target path', () => {
  assert.match(runtime, /const adActive = ad\(\)/);
  assert.match(runtime, /skipPattern/);
  assert.match(runtime, /arm\(skip, 'skip-ad', 600\)/);
  assert.match(runtime, /new MutationObserver\(\(\) => wake\(0\)\)/);
  assert.match(runtime, /attributeFilter: \['class','disabled','aria-disabled','aria-hidden'\]/);
  assert.doesNotMatch(runtime, /setInterval\(/);
  assert.doesNotMatch(runtime, /\.click\(\)/);
});

test('TVer runtime keeps playback recovery and natural completion compact', () => {
  assert.match(runtime, /video\.play\(\)\?\.catch/);
  assert.match(runtime, /video\.defaultPlaybackRate = 1\.75/);
  assert.match(runtime, /video\.volume !== 1\.0|video\.volume = 1\.0/);
  assert.match(runtime, /state\.programEndPending = true/);
  assert.match(runtime, /post\('homepanel:tver-ended'\)/);
  assert.match(runtime, /post\('homepanel:tver-media-init'\)/);
  assert.doesNotMatch(runtime, /episodeMaxPlaybackMs|setInterval\(/);
});

test('TVer keeps the native queue authoritative over page-side next episode routing', () => {
  assert.match(runtime, /const lockedEpisodePath = state\.lockedEpisodePath/);
  assert.match(runtime, /\['pushState', 'replaceState'\]/);
  assert.match(runtime, /event\.preventDefault\(\)/);
  assert.match(runtime, /event\.stopImmediatePropagation\(\)/);
});
