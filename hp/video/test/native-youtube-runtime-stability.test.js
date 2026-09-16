import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const reliablePlayAll = read('../../native/src/renderer_panels/media_youtube_playall_reliable.inc');
const runtime = read('../../native/src/renderer_panels/media_youtube_control_recovery.inc');
const host = read('../../native/src/renderer_panels/media_host.inc');
const trustedInput = read('../../native/src/renderer_panels/media_trusted_input.inc');

test('playlist fallback is bounded and event driven', () => {
  assert.match(reliablePlayAll, /window\.__homePanelYoutubePlaylistFallbackInstalled/);
  assert.match(reliablePlayAll, /ytd-playlist-video-renderer a#thumbnail/);
  assert.match(reliablePlayAll, /yt-page-data-updated/);
  assert.match(reliablePlayAll, /yt-navigate-finish/);
  assert.match(reliablePlayAll, /7000/);
  assert.match(reliablePlayAll, /v1\/native\/youtube-start/);
  assert.doesNotMatch(reliablePlayAll, /ytInitialData|MutationObserver|setInterval\(/);
  assert.match(host, /BeginYoutubePlaylistFallback\(\)/);
});

test('unified runtime owns trusted real-control actions', () => {
  assert.match(runtime, /const arm = \(element, action, cooldownMs\) =>/);
  assert.match(runtime, /getBoundingClientRect\?\.\(\)/);
  assert.match(runtime, /document\.elementFromPoint\(point\.x, point\.y\)/);
  assert.match(runtime, /setProperty\('pointer-events', 'auto', 'important'\)/);
  assert.match(runtime, /position:fixed!important/);
  assert.match(runtime, /return \[point\.x, point\.y\]/);
  assert.doesNotMatch(runtime, /point\.x \/ window\.innerWidth/);
  assert.doesNotMatch(runtime, /point\.y \/ window\.innerHeight/);
  assert.doesNotMatch(runtime, /return \[5000, 5000\]/);
  assert.match(runtime, /arm\(target, 'skip-ad', 600\)/);
  assert.match(runtime, /'play', 1500/);
  assert.match(runtime, /arm\(canonical, 'fullscreen', 1200\)/);
  assert.match(runtime, /fullscreenPattern = \/\(全画面\|fullscreen\|full screen\)\/i/);
});

test('fullscreen and ad clicks keep independent action state', () => {
  assert.match(runtime, /if \(action === 'fullscreen'\) return 'fullscreen'/);
  assert.match(runtime, /action === 'skip-ad' \|\| action\.startsWith\('survey-'\)/);
  assert.match(runtime, /const lane = actionState\(action\)/);
  assert.match(runtime, /lane\.cleanup\?\.\(\)/);
  assert.doesNotMatch(runtime, /state\.action = action/);
  assert.doesNotMatch(runtime, /state\.actionAt = now/);
  assert.doesNotMatch(runtime, /state\.actionCleanup = cleanup/);

  const firstFullscreen = runtime.indexOf('const fullscreenAction = armFullscreen();');
  const adStart = runtime.indexOf('if (ad()) {');
  assert.ok(firstFullscreen >= 0 && adStart > firstFullscreen);
  assert.match(runtime, /state\.fullscreenApplied = fullscreen\(\);\s*if \(!ad\(\) && !state\.fullscreenApplied\)/);
});

test('fullscreen recovery refreshes state instead of trusting old success', () => {
  assert.match(runtime, /fullscreenApplied: false/);
  assert.doesNotMatch(runtime, /state\.fullscreenApplied = true/);
  assert.doesNotMatch(runtime, /else if \(!state\.fullscreenApplied\)/);
  const refreshes = runtime.match(/state\.fullscreenApplied = fullscreen\(\);/g) || [];
  assert.ok(refreshes.length >= 2);
  const finalFullscreen = runtime.lastIndexOf('const fullscreenAction = armFullscreen();');
  const finalRecovery = runtime.lastIndexOf("return 'recovery';");
  assert.ok(finalFullscreen >= 0 && finalRecovery > finalFullscreen);
});

test('skippable ads are handled before fullscreen recovery', () => {
  const adStart = runtime.indexOf('if (ad()) {');
  const skip = runtime.indexOf("arm(target, 'skip-ad', 600)", adStart);
  const fullscreen = runtime.indexOf('const action = armFullscreen();', adStart);
  assert.ok(adStart >= 0 && skip > adStart && fullscreen > skip);
});

test('unified runtime stays player-local and event driven', () => {
  assert.match(runtime, /new AbortController\(\)/);
  assert.match(runtime, /homepanel:youtube-wake/);
  assert.match(runtime, /attributeFilter: \['class'\]/);
  assert.match(runtime, /state\.classObserver\.observe\(player/);
  assert.doesNotMatch(runtime, /observe\(document\.(?:documentElement|body)/);
});

test('recovery remains a single policy without split include fragments', () => {
  assert.match(runtime, /kNativeMediaYoutubeControlRecoveryScript/);
  assert.match(runtime, /if \(ad\(\)\)/);
  assert.match(runtime, /state\.pausedSince >= 10 \* 1000/);
  assert.match(runtime, /state\.lastProgressAt >= 30 \* 1000/);
  assert.doesNotMatch(runtime, /#include "media_youtube_control_recovery_/);
});

test('trusted CDP clicks remain serialized', () => {
  assert.match(trustedInput, /kNativeMediaTrustedClickStaleMs = 3000ULL/);
  assert.match(trustedInput, /NativeMediaAcquireTrustedClick\(\)/);
  assert.match(trustedInput, /NativeMediaReleaseTrustedClick\(clickToken\)/);
});
