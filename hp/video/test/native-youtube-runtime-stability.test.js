import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const reliablePlayAll = read('../../native/src/renderer_panels/media_youtube_playall_reliable.inc');
const recovery = read('../../native/src/renderer_panels/media_youtube_control_recovery.inc');
const trustedAction = read('../../native/src/renderer_panels/media_youtube_trusted_action.inc');
const eventAgent = read('../../native/src/renderer_panels/media_youtube_event_agent.inc');
const host = read('../../native/src/renderer_panels/media_host.inc');
const trustedInput = read('../../native/src/renderer_panels/media_trusted_input.inc');

test('playlist fallback is bounded and event driven', () => {
  assert.match(reliablePlayAll, /window\.__homePanelYoutubePlaylistFallbackInstalled/);
  assert.match(reliablePlayAll, /window\.ytInitialData/);
  assert.match(reliablePlayAll, /visited\+\+ < 2500/);
  assert.match(reliablePlayAll, /new MutationObserver\(resolve\)/);
  assert.match(reliablePlayAll, /yt-page-data-updated/);
  assert.match(reliablePlayAll, /yt-navigate-finish/);
  assert.match(reliablePlayAll, /7000/);
  assert.match(reliablePlayAll, /v1\/native\/youtube-start/);
  assert.doesNotMatch(reliablePlayAll, /setInterval\(/);
  assert.match(host, /BeginYoutubePlaylistFallback\(\)/);
});

test('trusted actions use one real-control bridge', () => {
  assert.match(trustedAction, /const arm = \(element, action, cooldownMs\) =>/);
  assert.match(trustedAction, /element\.style\.setProperty\(name, value, 'important'\)/);
  assert.match(trustedAction, /return \[5000, 5000\]/);
  assert.match(recovery, /trusted\.arm\(target, 'skip-ad', 600\)/);
  assert.match(recovery, /trusted\.arm\(play, 'play', 1500\)/);
  assert.match(recovery, /trusted\.arm\(target, 'fullscreen', 1200\)/);
});

test('event agent stays player-local with one wake and recovery timer', () => {
  assert.match(eventAgent, /new AbortController\(\)/);
  assert.match(eventAgent, /homepanel:youtube-wake/);
  assert.match(eventAgent, /scheduleRecoveryWake/);
  assert.match(eventAgent, /attributeFilter: \['class'\]/);
  assert.match(eventAgent, /state\.classObserver\.observe\(player/);
  assert.doesNotMatch(eventAgent, /lastWakeSignature|pendingWakeDirty|playerObserver/);
  assert.doesNotMatch(eventAgent, /observe\(document\.(?:documentElement|body)/);
});

test('recovery is a single policy without split include fragments', () => {
  assert.match(recovery, /kNativeMediaYoutubeControlRecoveryScript/);
  assert.match(recovery, /if \(trusted\.ad\(\)\)/);
  assert.match(recovery, /const pauseEscalationMs = 10 \* 1000/);
  assert.match(recovery, /const stallEscalationMs = 30 \* 1000/);
  assert.doesNotMatch(recovery, /#include "media_youtube_control_recovery_/);
});

test('trusted CDP clicks remain serialized', () => {
  assert.match(trustedInput, /kNativeMediaTrustedClickStaleMs = 3000ULL/);
  assert.match(trustedInput, /NativeMediaAcquireTrustedClick\(\)/);
  assert.match(trustedInput, /NativeMediaReleaseTrustedClick\(clickToken\)/);
});
