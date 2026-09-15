import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(
  new URL('../../native/src/spotify_host_layout.inc', import.meta.url),
  'utf8',
);

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section terminator: ${end}`);
  return text.slice(from, to);
}

test('Spotify stable playback and non-playing transitions stay fullscreen behind native UI', () => {
  const placeHosts = section(
    layout,
    'void SpotifyWebViews::PlaceHosts() noexcept {',
    'void SpotifyWebViews::RefreshSpotifyHostLayout() noexcept {',
  );

  assert.doesNotMatch(placeHosts, /const bool backgroundWork = !SlotStateIsHealthy\(slot\.state\);/);
  assert.match(placeHosts, /const int hostX = client\.left;/);
  assert.match(placeHosts, /const int hostY = client\.top;/);
  assert.match(placeHosts, /client\.right - client\.left/);
  assert.match(placeHosts, /client\.bottom - client\.top/);
  assert.doesNotMatch(placeHosts, /kSpotifyBackgroundWidth|kSpotifyBackgroundHeight|ComputeMediaSurfaceAnchors|anchors\.air|CenterMediaSurfaceOnAnchor/);
  assert.match(placeHosts, /authentication \|\| monitorForeground_ \? HWND_TOP : HWND_BOTTOM/);
});

test('Spotify authentication and Monitor C use foreground z-order without changing full-client geometry', () => {
  const placeHosts = section(
    layout,
    'void SpotifyWebViews::PlaceHosts() noexcept {',
    'void SpotifyWebViews::RefreshSpotifyHostLayout() noexcept {',
  );

  assert.match(placeHosts, /const bool authentication =\s*i == hostLayoutAuthenticationSlot_ && SlotIsLoginPage\(slot\);/);
  assert.match(placeHosts, /const int hostX = client\.left;/);
  assert.match(placeHosts, /const int hostY = client\.top;/);
  assert.match(placeHosts, /authentication \|\| monitorForeground_ \? HWND_TOP : HWND_BOTTOM/);
});

test('layout refresh reacts to Playing-to-transition and transition-to-Playing changes', () => {
  const refresh = section(
    layout,
    'void SpotifyWebViews::RefreshSpotifyHostLayout() noexcept {',
    '}  // namespace hp',
  );

  assert.match(refresh, /if \(!SlotStateIsHealthy\(slots_\[i\]\.state\)\) mask \|= \(1u << i\);/);
  assert.match(refresh, /foregroundAuthenticationIndex/);
  assert.match(refresh, /hostLayoutMask_ == mask/);
  assert.match(refresh, /hostLayoutAuthenticationSlot_ == foregroundAuthenticationIndex/);
  assert.match(refresh, /PlaceHosts\(\);/);
});
