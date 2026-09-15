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

test('Spotify stable playback and non-playing transitions stay onscreen at 160x320 behind the air panel', () => {
  const placeHosts = section(
    layout,
    'void SpotifyWebViews::PlaceHosts() noexcept {',
    'void SpotifyWebViews::RefreshSpotifyHostLayout() noexcept {',
  );

  assert.match(layout, /kSpotifyBackgroundWidth = 160/);
  assert.match(layout, /kSpotifyBackgroundHeight = 320/);
  assert.doesNotMatch(placeHosts, /const bool backgroundWork = !SlotStateIsHealthy\(slot\.state\);/);
  assert.match(placeHosts, /ComputeMediaSurfaceAnchors\(client\)/);
  assert.match(placeHosts, /anchors\.air/);
  assert.match(placeHosts, /const int hostX = backgroundSurface\.left;/);
  assert.match(placeHosts, /const int hostY = backgroundSurface\.top;/);
  assert.doesNotMatch(placeHosts, /client\.right \+ 1|client\.bottom \+ 1/);
  assert.match(placeHosts, /authentication \|\| monitorForeground_ \? HWND_TOP : HWND_BOTTOM/);
});

test('Spotify authentication and Monitor C use foreground z-order without changing the 160x320 air-panel geometry', () => {
  const placeHosts = section(
    layout,
    'void SpotifyWebViews::PlaceHosts() noexcept {',
    'void SpotifyWebViews::RefreshSpotifyHostLayout() noexcept {',
  );

  assert.match(
    placeHosts,
    /const bool authentication =\s*i == hostLayoutAuthenticationSlot_ && SlotIsLoginPage\(slot\);/,
  );
  assert.match(placeHosts, /CenterMediaSurfaceOnAnchor/);
  assert.match(placeHosts, /const int hostX = backgroundSurface\.left;/);
  assert.match(placeHosts, /const int hostY = backgroundSurface\.top;/);
  assert.match(placeHosts, /authentication \|\| monitorForeground_ \? HWND_TOP : HWND_BOTTOM/);
  assert.doesNotMatch(placeHosts, /width = clientWidth|height = clientHeight/);
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
