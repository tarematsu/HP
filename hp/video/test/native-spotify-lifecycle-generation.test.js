import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const host = readFileSync(
  new URL('../../native/src/spotify_host_lifecycle.inc', import.meta.url), 'utf8');
const network = readFileSync(
  new URL('../../native/src/spotify_network_block.inc', import.meta.url), 'utf8');

test('each Spotify start gets a fresh async generation token', () => {
  assert.match(
    host,
    /void SpotifyWebViews::Start\(\)[\s\S]*alive_ = std::make_shared<std::atomic<bool>>\(true\);/,
  );
  assert.doesNotMatch(
    host,
    /void SpotifyWebViews::Start\(\)[\s\S]*alive_->store\(true, std::memory_order_release\);/,
  );
  assert.match(
    host,
    /void SpotifyWebViews::Shutdown\(\)[\s\S]*alive_->store\(false, std::memory_order_release\);/,
  );
});

test('network recovery uses the same fresh-generation lifecycle', () => {
  assert.match(network, /alive_->store\(false, std::memory_order_release\)/);
  assert.match(network, /alive_ = std::make_shared<std::atomic<bool>>\(true\);/);
});
