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

test('Spotify stable playback is parked offscreen while work states stay onscreen behind the dashboard', () => {
  const placeHosts = section(
    layout,
    'void SpotifyWebViews::PlaceHosts() noexcept {',
    'void SpotifyWebViews::RefreshSpotifyHostLayout() noexcept {',
  );

  assert.match(layout, /kSpotifyBackgroundWidth = 480/);
  assert.match(layout, /kSpotifyBackgroundHeight = 270/);
  assert.match(placeHosts, /const bool backgroundWork = !SlotStateIsHealthy\(slot\.state\);/);
  assert.match(
    placeHosts,
    /int hostX = backgroundWork \|\| authentication \? x : client\.right \+ 1;/,
  );
  assert.match(
    placeHosts,
    /int hostY = backgroundWork \|\| authentication \? y : client\.bottom \+ 1;/,
  );
  assert.match(placeHosts, /HWND insertAfter = authentication \? HWND_TOP : HWND_BOTTOM;/);
});

test('Spotify authentication is onscreen foreground and Monitor C remains full-size foreground', () => {
  const placeHosts = section(
    layout,
    'void SpotifyWebViews::PlaceHosts() noexcept {',
    'void SpotifyWebViews::RefreshSpotifyHostLayout() noexcept {',
  );

  assert.match(
    placeHosts,
    /const bool authentication =\s*i == hostLayoutAuthenticationSlot_ && SlotIsLoginPage\(slot\);/,
  );
  assert.match(placeHosts, /backgroundWork \|\| authentication \? x/);
  assert.match(placeHosts, /authentication \? HWND_TOP : HWND_BOTTOM/);
  assert.match(
    placeHosts,
    /if \(monitorForeground_\) \{[\s\S]*hostX = x;[\s\S]*hostY = y;[\s\S]*width = clientWidth;[\s\S]*height = clientHeight;[\s\S]*insertAfter = HWND_TOP;/,
  );
});

test('layout refresh observes both health transitions and authentication transitions', () => {
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
