import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const runtime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const mediaSection = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');

test('TVer real fullscreen remains authoritative and uses trusted recovery', () => {
  assert.doesNotMatch(runtime, /__homePanelTverEnsureViewportFullscreen|viewportFullscreen/);
  assert.match(runtime, /document\.fullscreenElement/);
  assert.match(runtime, /post\('homepanel:tver-fullscreen-key'\)/);
  assert.match(runtime, /arm\(fullscreenControl\(\), 'fullscreen', 1200\)/);
  assert.match(mediaSection, /NativeMediaRequestTverBrowserFullscreen/);
  assert.match(mediaSection, /Runtime\.evaluate/);
  assert.match(mediaSection, /"userGesture":true/);
});

test('TVer page and WebView cannot route themselves to another episode', () => {
  assert.match(runtime, /const lockedEpisodePath = state\.lockedEpisodePath \|\| location\.pathname/);
  assert.match(runtime, /const differentEpisode = value =>/);
  assert.match(runtime, /\['pushState', 'replaceState'\]/);
  assert.match(runtime, /history\[methodName\] = function/);
  assert.match(runtime, /event\.preventDefault\(\)/);
  assert.match(runtime, /event\.stopImmediatePropagation\(\)/);
  assert.match(mediaSection, /add_NavigationStarting/);
  assert.match(mediaSection, /NativeMediaTverEpisodeIdFromUrl/);
  assert.match(mediaSection, /NativeMediaTverCurrentEpisodeUrl/);
  assert.match(mediaSection, /args->put_Cancel\(TRUE\)/);
});

test('TVer reused video nodes cannot inherit completion from another media source', () => {
  assert.match(runtime, /const mediaKey = \(\) =>/);
  assert.match(runtime, /if \(state\.mediaKey !== key\) \{/);
  assert.match(runtime, /state\.mediaKey = key/);
  assert.match(runtime, /key === state\.programKey/);
  assert.match(runtime, /state\.programEndPending = true/);
  assert.doesNotMatch(runtime, /endCandidateIdentity|mediaSourceIdentity/);
});
