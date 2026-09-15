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
  assert.match(reliablePlayAll, /window\.ytInitialData/);
  assert.match(reliablePlayAll, /visited\+\+ < 2500/);
  assert.match(reliablePlayAll, /new MutationObserver\(resolve\)/);
  assert.match(reliablePlayAll, /yt-page-data-updated/);
  assert.match(reliablePlayAll, /7000/);
  assert.doesNotMatch(reliablePlayAll, /setInterval\(/);
  assert.match(host, /BeginYoutubePlaylistFallback\(\)/);
});

test('unified runtime owns trusted real-control actions', () => {
  assert.match(runtime, /const arm = \(element, action, cooldownMs\) =>/);
  assert.match(runtime, /element\.style\.cssText \+=/);
  assert.match(runtime, /return \[5000, 5000\]/);
  assert.match(runtime, /arm\(target, 'skip-ad', 600\)/);
  assert.match(runtime, /'play', 1500/);
  assert.match(runtime, /arm\(target, 'fullscreen', 1200\)/);
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