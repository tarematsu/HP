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
const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url),
  'utf8',
);

test('Spotify network block destroys all configured WebView/controller slots', () => {
  assert.match(header, /void SetNetworkBlocked\(bool blocked\) noexcept/);
  assert.match(header, /bool networkBlocked_ = false/);
  assert.match(network, /alive_->store\(false, std::memory_order_release\)/);
  assert.match(network, /for \(Slot& slot : slots_\) CloseSlot\(slot\)/);
});

test('Spotify unmute uses a fresh async generation and recreates every configured host', () => {
  assert.match(network, /alive_ = std::make_shared<std::atomic<bool>>\(true\)/);
  assert.match(network, /for \(Slot& slot : slots_\)[\s\S]*CreateHost\(slot\)/);
  assert.match(network, /CreateController\(slots_\[0\]\)/);
  assert.match(network, /timedTarget = TimedSpotifyTarget::None/);
  assert.match(network, /podcastBreakActive = false/);
  assert.match(network, /StartAutonomousSchedule\(GetTickCount64\(\)\)/);
});

test('global media mute remains the only media-to-Spotify state coupling', () => {
  assert.match(lifecycle, /gSpotifyMediaNetworkBlocked = false/);
  assert.match(
    lifecycle,
    /SetSpotifyMediaNetworkBlocked\(bool blocked\)[\s\S]*SetNetworkBlocked\(blocked\)/,
  );
  assert.match(
    lifecycle,
    /void SetSpotifyMediaPhase\(bool\) noexcept \{[\s\S]*Spotify intentionally ignores YouTube\/TVer phase changes/,
  );
  assert.doesNotMatch(lifecycle, /gSpotifyTverPhase|SetPodcastMode/);
});

test('unmute restarts autonomous A-B-C-D without a media-phase wait', () => {
  assert.match(
    schedule,
    /if \(!slot\.timedRotationActive\)[\s\S]*InitializeTimedRotationSlot\(slot, now\);/,
  );
  assert.match(schedule, /StartAutonomousSchedule/);
  assert.doesNotMatch(schedule, /20-minute|TVer|YouTube|podcastMode_/);
});