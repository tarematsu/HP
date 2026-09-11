import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const reliablePlayAll = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_playall_reliable.inc', import.meta.url), 'utf8');
const recovery = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url), 'utf8');
const trustedAction = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_trusted_action.inc', import.meta.url), 'utf8');
const eventAgent = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_event_agent.inc', import.meta.url), 'utf8');
const host = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url), 'utf8');
const trustedInput = readFileSync(
  new URL('../../native/src/renderer_panels/media_trusted_input.inc', import.meta.url), 'utf8');

test('YouTube playlist startup can resolve the first video before Polymer DOM settles', () => {
  assert.match(reliablePlayAll, /window\.ytInitialData/);
  assert.match(reliablePlayAll, /playlistVideoRenderer/);
  assert.match(reliablePlayAll, /playlistPanelVideoRenderer/);
  assert.match(reliablePlayAll, /navigateVideoId\(renderer\.videoId\)/);
  assert.match(reliablePlayAll, /visited < 5000/);
  assert.match(reliablePlayAll, /url\.searchParams\.set\('list', playlistId\)/);
});

test('playlist startup remains bounded and native fallback reloads if watch never starts', () => {
  assert.match(reliablePlayAll, /__homePanelYoutubePlaylistStartupState/);
  assert.match(host, /kNativeMediaPlayAllRetryLimit/);
  assert.match(host, /ReloadYoutubePlaylist\(\)/);
  assert.match(host, /IsYoutubeWatchPage\(\)/);
});

test('repeated YouTube trusted actions have per-action settle windows', () => {
  assert.match(trustedAction, /const reserve = \(action, cooldownMs\) =>/);
  assert.match(recovery, /trusted\.arm\(target, 'skip-ad', 600\)/);
  assert.match(recovery, /trusted\.arm\(play, 'play', 1500\)/);
  assert.match(recovery, /trusted\.arm\(target, 'fullscreen', 1200\)/);
});

test('transparent clean-player chrome still supports trusted fullscreen recovery', () => {
  assert.match(recovery, /player\.querySelector\('\.ytp-fullscreen-button'\)/);
  assert.match(trustedAction, /visibility', 'visible'/);
  assert.match(trustedAction, /pointer-events', 'auto'/);
  assert.match(trustedAction, /opacity', '0'/);
  assert.match(trustedAction, /return \[5000, 5000\]/);
});

test('YouTube event agent is player-local and coalesces wake notifications', () => {
  assert.match(eventAgent, /lastWakeSignature/);
  assert.match(eventAgent, /pendingWakeSignature/);
  assert.match(eventAgent, /250 - \(Date\.now\(\) - state\.wakeAt\)/);
  assert.match(eventAgent, /nextSignature === state\.lastWakeSignature/);
  assert.match(eventAgent, /state\.playerObserver\.observe\(player, \{ childList: true, subtree: true \}\)/);
  assert.match(eventAgent, /attributeFilter: \['class'\]/);
  assert.doesNotMatch(eventAgent, /observe\(document\.(?:documentElement|body)/);
});

test('trusted CDP clicks are serialized and stale locks recover', () => {
  assert.match(trustedInput, /kNativeMediaTrustedClickStaleMs = 3000ULL/);
  assert.match(trustedInput, /gNativeMediaTrustedClickStartedAt/);
  assert.match(trustedInput, /NativeMediaAcquireTrustedClick\(\)/);
  assert.match(trustedInput, /compare_exchange_weak/);
  assert.match(trustedInput, /NativeMediaReleaseTrustedClick\(clickToken\)/);
});
