import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);
const network = readFileSync(
  new URL('../../native/src/spotify_network_block.inc', import.meta.url),
  'utf8',
);
const lifecycle = readFileSync(
  new URL('../../native/src/renderer_lifecycle.cpp', import.meta.url),
  'utf8',
);

test('Spotify network block destroys all six WebView/controller slots', () => {
  assert.match(header, /void SetNetworkBlocked\(bool blocked\) noexcept/);
  assert.match(header, /bool networkBlocked_ = false/);
  assert.match(network, /alive_->store\(false, std::memory_order_release\)/);
  assert.match(network, /for \(Slot& slot : slots_\) CloseSlot\(slot\)/);
});

test('Spotify unmute uses a fresh async generation and recreates the six hosts', () => {
  assert.match(network, /alive_ = std::make_shared<std::atomic<bool>>\(true\)/);
  assert.match(network, /for \(Slot& slot : slots_\)[\s\S]*CreateHost\(slot\)/);
  assert.match(network, /CreateController\(slots_\[0\]\)/);
  assert.match(network, /timedTarget = TimedSpotifyTarget::None/);
});

test('global media mute gate preserves desired phase while Spotify is offline', () => {
  assert.match(lifecycle, /gSpotifyMediaNetworkBlocked = false/);
  assert.match(lifecycle, /gSpotifyTverPhase = false/);
  assert.match(
    lifecycle,
    /SetSpotifyMediaPhase\(bool tverPhase\)[\s\S]*gSpotifyTverPhase = tverPhase[\s\S]*!gSpotifyMediaNetworkBlocked/,
  );
  assert.match(
    lifecycle,
    /SetSpotifyMediaNetworkBlocked\(bool blocked\)[\s\S]*SetNetworkBlocked\(blocked\)[\s\S]*SetPodcastMode\(!gSpotifyTverPhase\)/,
  );
});
