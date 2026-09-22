import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const episode = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const watchdog = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url);
const mediaSection = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');

test('TVer CSS viewport fill never suppresses real browser fullscreen recovery', () => {
  assert.match(watchdog, /__homePanelTverEnsureViewportFullscreen\(video\)/);
  assert.match(watchdog, /const browserFullscreen = document\.fullscreenElement/);
  assert.match(watchdog, /if \(browserFullscreen\) \{/);
  assert.doesNotMatch(watchdog, /browserFullscreen \|\| viewportFullscreen/);
  assert.match(watchdog, /state\.fullscreenDirty = true/);
  assert.match(watchdog, /homepanel:tver-fullscreen-key/);
  assert.match(mediaSection, /NativeMediaRequestTverBrowserFullscreen/);
  assert.match(mediaSection, /Runtime\.evaluate/);
  assert.match(mediaSection, /"userGesture":true/);
});

test('TVer page and WebView cannot route themselves to another episode', () => {
  assert.match(episode, /const lockedEpisodePath = location\.pathname/);
  assert.match(episode, /isDifferentEpisodeRoute/);
  assert.match(episode, /\['pushState', 'replaceState'\]/);
  assert.match(episode, /history\[methodName\] = function/);
  assert.match(episode, /event\.preventDefault\(\)/);
  assert.match(episode, /event\.stopImmediatePropagation\(\)/);
  assert.match(mediaSection, /add_NavigationStarting/);
  assert.match(mediaSection, /NativeMediaTverEpisodeIdFromUrl/);
  assert.match(mediaSection, /NativeMediaTverCurrentEpisodeUrl/);
  assert.match(mediaSection, /args->put_Cancel\(TRUE\)/);
});

test('TVer reused video nodes cannot inherit completion state from replaced media', () => {
  assert.match(episode, /const mediaSourceIdentity = video =>/);
  assert.match(episode, /sourceIdentity !== state\.mediaSourceIdentity/);
  assert.match(episode, /sourceChanged && !state\.endCandidateAt/);
  assert.match(episode, /state\.mediaSourceIdentity = mediaSourceIdentity\(video\)/);
  assert.match(episode, /video\.addEventListener\('emptied',[\s\S]*resetMediaState\(state, video\)/);
});
