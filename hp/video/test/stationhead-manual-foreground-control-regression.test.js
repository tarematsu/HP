import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const visibility = readFileSync(
  new URL('../../native/src/stationhead_manual_visibility.h', import.meta.url),
  'utf8',
);
const overlay = readFileSync(
  new URL('../../native/src/stationhead_visibility_overlay.h', import.meta.url),
  'utf8',
);
const layout = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
  'utf8',
);
const appState = readFileSync(
  new URL('../../native/src/app_stationhead_state.cpp', import.meta.url),
  'utf8',
);
const main = readFileSync(
  new URL('../../native/src/main.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('manual Stationhead foreground state is explicit and independent of login detection', () => {
  assert.match(visibility, /gStationheadManualForeground/);
  assert.match(visibility, /StationheadManualForegroundEnabled\(\)/);
  assert.match(visibility, /ToggleStationheadManualForeground\(\)/);

  const selectTab = section(
    layout,
    'void StationheadPlayer::SelectTab(StationheadTabKind tab) {',
    'bool StationheadPlayer::HasAuthTab() const',
  );
  assert.match(selectTab, /if \(spotifyAuthorization_\)[\s\S]*StationheadTabKind::Auth/);
  assert.match(selectTab, /StationheadManualForegroundEnabled\(\)/);
  assert.match(selectTab, /loginRequired_ = false;/);
  assert.match(selectTab, /status_\.loginRequired = false;/);
  assert.match(selectTab, /tab = StationheadTabKind::None;/);
});

test('manual foreground gives A and B stable left/right halves', () => {
  const resolver = section(
    layout,
    'RECT ResolveStationheadWorkspaceBounds(',
    'struct StationheadSurfacePolicy',
  );
  assert.match(resolver, /StationheadManualForegroundEnabled\(\)/);
  assert.match(resolver, /ConfiguresSecondaryStationheadWindow\(config\)/);
  assert.match(resolver, /role == StationheadRole::Secondary/);
  assert.match(resolver, /RECT\{mid, client\.top, client\.right, client\.bottom\}/);
  assert.match(resolver, /RECT\{client\.left, client\.top, mid, client\.bottom\}/);
});

test('dashboard no longer publishes Stationhead login-required as an interaction state', () => {
  const enrich = section(
    appState,
    'void App::EnrichRenderStationheadState(',
    'void App::ToggleStationheadAudio()',
  );
  assert.match(enrich, /state\.loginRequired = false;/);
  assert.doesNotMatch(enrich, /secondaryStatus->loginRequired/);
  assert.match(enrich, /secondaryStatus->spotifyAuthorization/);
});

test('visibility button sits in the reserved slot directly below MUTE and stays above WebViews', () => {
  const button = section(
    overlay,
    'RECT ParentButtonRect() const noexcept {',
    'void LayoutOverlay()',
  );
  assert.match(button, /const LONG muteBottom = clusterTop \+ buttonHeight \* 2 \+ buttonGap;/);
  assert.match(button, /const LONG top = muteBottom \+ buttonGap;/);
  assert.match(button, /footerHeight/);

  const placement = section(
    overlay,
    'void LayoutOverlay()',
    'void PaintOverlay(',
  );
  assert.match(placement, /SetWindowPos\([\s\S]*overlay_, HWND_TOP/);
  assert.match(placement, /SWP_NOACTIVATE \| SWP_SHOWWINDOW/);
  assert.match(overlay, /foreground \? L"背面化" : L"前面化"/);
  assert.match(overlay, /ToggleStationheadManualForeground\(\)/);
  assert.match(overlay, /SendMessageW\([\s\S]*parent_, WM_SIZE/);
});

test('Stationhead visibility overlay is installed alongside the power-saving overlay', () => {
  assert.match(main, /#include "stationhead_visibility_overlay\.h"/);
  assert.match(main, /PowerSavingController powerSavingController/);
  assert.match(main, /StationheadVisibilityOverlay stationheadVisibilityOverlay/);
  assert.match(main, /stationheadVisibilityOverlay\.InstallForCurrentThread\(\)/);
  assert.match(main, /stationheadVisibilityOverlay\.Uninstall\(\)/);
});
