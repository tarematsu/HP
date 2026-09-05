import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const guard = readFileSync(
  new URL('../../native/src/spotify_lonesome_guard.inc', import.meta.url),
  'utf8',
);
const click = readFileSync(
  new URL('../../native/src/spotify_background_click.inc', import.meta.url),
  'utf8',
);
const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url),
  'utf8',
);
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);

test('serialized Spotify recovery shows only the active slot in a larger centered viewport', () => {
  assert.match(guard, /activeWidth = std::max\(1, clientWidth \* 3 \/ 5\)/);
  assert.match(guard, /activeHeight = std::max\(1, clientHeight \* 9 \/ 10\)/);
  assert.match(guard, /staggerSlotIndex_ % owner->slots_\.size\(\)/);
  assert.match(guard, /slot->index != activeIndex[\s\S]*ParkSpotifyHost/);
  assert.match(guard, /ExpandSpotifyRecoveryHost/);
  assert.match(header, /hostLayoutActiveSlot_ = kAccountCount/);
});

test('the active Spotify WebView uses 80 percent page zoom', () => {
  assert.match(guard, /kSpotifySerializedRecoveryZoom = 0\.80/);
  assert.match(guard, /controller->get_ZoomFactor\(&zoom\)/);
  assert.match(guard, /controller->put_ZoomFactor\(kSpotifySerializedRecoveryZoom\)/);
});

test('trusted CDP clicks compensate for WebView2 zoom before dispatch', () => {
  assert.match(click, /controller->get_ZoomFactor\(&controllerZoom\)/);
  assert.match(click, /cssWidth = static_cast<double>\(width\) \/ zoom/);
  assert.match(click, /cssHeight = static_cast<double>\(height\) \/ zoom/);
  assert.match(click, /Input\.dispatchMouseEvent/);
});

test('advancing the ten-minute owner refreshes which single host is expanded', () => {
  const advances = schedule.match(
    /staggerSlotIndex_ = \(staggerSlotIndex_ \+ 1\) % slots_\.size\(\);[\s\S]{0,180}?RefreshSpotifyHostLayout\(\);/g,
  ) || [];
  assert.equal(advances.length, 2);
});

test('each serialized tick refreshes layout before returning early for a login page', () => {
  assert.match(
    schedule,
    /Slot& slot = slots_\[staggerSlotIndex_\];[\s\S]*RefreshSpotifyHostLayout\(\);[\s\S]*if \(slot\.webview && SlotIsLoginPage\(slot\)\)/,
  );
});
