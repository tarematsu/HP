import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const runtime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const fullscreen = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_playback_policy_force_fullscreen.inc', import.meta.url),
  'utf8',
);

test('TVer has no viewport-fill pseudo fullscreen', () => {
  assert.doesNotMatch(runtime, /data-homepanel-tver-fill|homepanel-tver-viewport-fill/);
  assert.doesNotMatch(runtime, /position:fixed !important; inset:0 !important/);
  assert.match(runtime, /if \(!fullscreen\(\)\) return requestFullscreen\(\)/);
  assert.match(runtime, /document\.fullscreenElement/);
});

test('TVer fullscreen targets actual labeled controls, never a blind corner', () => {
  assert.match(runtime, /const requestFullscreen = \(\) =>/);
  assert.match(runtime, /const fullscreenSelector = \[/);
  assert.match(runtime, /document\.querySelectorAll\(fullscreenSelector\)/);
  assert.match(runtime, /arm\(element, 'fullscreen', 1400\)/);
  assert.match(runtime, /return action;/);
  assert.doesNotMatch(runtime, /rect\.right - 12|rect\.bottom - 12/);
});

test('TVer waits for native CDP result before attempting a labeled UI click', () => {
  assert.match(runtime, /state\.currentSettingsFullscreenRequestAt/);
  assert.match(runtime, /now - state\.currentSettingsFullscreenRequestAt < 1500/);
  assert.match(runtime, /state\.fullscreenCornerTapAt/);
  assert.match(runtime, /wake\(1500\)/);
  assert.match(runtime, /document\.fullscreenElement/);
});

test('TVer post-click fallback consumes trusted activation before native escalation', () => {
  assert.match(fullscreen, /const isFullscreen = \(\) =>/);
  assert.match(fullscreen, /state\.fullscreenCornerTapAt = 0/);
  assert.match(fullscreen, /__homePanelTverFullscreenControlGuard/);
  assert.match(fullscreen, /aria-label\*="全画面"/);
  assert.match(fullscreen, /data-testid\*="fullscreen" i/);
  assert.match(fullscreen, /display:flex!important/);
  assert.match(fullscreen, /visibility:visible!important/);
  assert.match(fullscreen, /pointer-events:auto!important/);
  assert.match(fullscreen, /const fullscreenTapPending/);
  assert.match(fullscreen, /Date\.now\(\) - state\.fullscreenCornerTapAt <= 3000/);
  assert.match(fullscreen, /const fullscreenTarget = \(\) =>/);
  assert.match(fullscreen, /requestFullscreen|webkitRequestFullscreen|msRequestFullscreen/);
  assert.match(fullscreen, /request\.call\(target\)/);
  assert.match(fullscreen, /window\.setTimeout\(\(\) => \{/);
  assert.match(fullscreen, /homepanel:tver-fullscreen-key/);
  assert.match(fullscreen, /homepanel:tver-wake/);
});

test('natural TVer completion has no wall-clock safety cap', () => {
  assert.doesNotMatch(
    runtime,
    /episodeMaxPlaybackMs|episodeStartedAt|episodeLimitTimer|armEpisodeLimit|enforceEpisodeLimit/,
  );
  assert.match(runtime, /event\.type === 'ended'/);
  assert.match(runtime, /key === state\.programKey/);
  assert.match(runtime, /state\.programEndPending = true/);
  assert.match(runtime, /post\('homepanel:tver-ended'\)/);
});
