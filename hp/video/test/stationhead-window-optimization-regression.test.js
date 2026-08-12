import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layoutSource = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('startup preview keeps normal playback backgrounded but preserves explicit interaction', () => {
  const createHost = section(
    layoutSource,
    'HWND CreateStationheadChildHost(',
    'bool WindowClientSizeMatches(',
  );
  assert.match(createHost, /bounds\.left, bounds\.top, 1, 1/);

  const setPreviewBounds = section(
    layoutSource,
    'void StationheadPlayer::SetStartupPreviewBounds(const RECT& bounds)',
    'void StationheadPlayer::ClearStartupPreviewBounds()',
  );
  assert.match(setPreviewBounds, /startupPreviewActive_ = true;/);
  assert.match(setPreviewBounds, /bounds_ = bounds;/);
  assert.match(
    setPreviewBounds,
    /if \(selectedTab_ == StationheadTabKind::None\) \{[\s\S]*KeepPlaybackBehindDashboard\(\);[\s\S]*return;/,
  );
  assert.match(setPreviewBounds, /viewVisible_ = true;[\s\S]*LayoutControllers\(\);/);
});

test('background host clips a normal-size playback viewport while interactive auth can expand it', () => {
  const applyLayout = section(
    layoutSource,
    'void ApplyStationheadChildLayout(',
    '\n}\n\n}\n\nbool StationheadPlayer::EnsureHostWindow()',
  );
  assert.match(applyLayout, /const int hostWidth = showPlayback \? width : 1;/);
  assert.match(applyLayout, /const int hostHeight = showPlayback \? height : 1;/);
  assert.match(applyLayout, /const HWND hostPlacement = showPlayback \? HWND_TOP : HWND_BOTTOM;/);
  assert.match(applyLayout, /const RECT contentBounds\{0, 0, width, height\};/);
  assert.match(
    applyLayout,
    /SetWindowPos\(hostWindow, hostPlacement,[\s\S]*hostWidth, hostHeight/,
  );
  assert.match(applyLayout, /controller->put_Bounds\(contentBounds\);/);
  assert.doesNotMatch(
    applyLayout,
    /const RECT contentBounds\{0, 0, hostWidth, hostHeight\};/,
  );
});

test('duplicate hide notifications verify stable playback and auth surfaces', () => {
  const setVisible = section(
    layoutSource,
    'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()',
  );
  assert.match(
    setVisible,
    /!viewVisible_[\s\S]*selectedTab_ == StationheadTabKind::None[\s\S]*PlaybackSurfaceMatches\([\s\S]*1, 1, HWND_BOTTOM\)[\s\S]*HiddenAuthSurfaceMatches\([\s\S]*return;/,
  );
  assert.match(setVisible, /const bool hadInteractiveSurface/);
  assert.match(setVisible, /const bool interactiveSurfaceHadFocus/);
  assert.match(
    setVisible,
    /hadInteractiveSurface && interactiveSurfaceHadFocus &&[\s\S]*GetFocus\(\) != window_[\s\S]*SetFocus\(window_\)/,
  );
});

test('explicit Stationhead interaction may reuse the playback surface while normal playback stays background-only', () => {
  const setVisible = section(
    layoutSource,
    'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()',
  );
  assert.match(
    setVisible,
    /selectedTab_ != StationheadTabKind::Auth &&[\s\S]*selectedTab_ != StationheadTabKind::Stationhead[\s\S]*KeepPlaybackBehindDashboard\(\)[\s\S]*return;/,
  );
  assert.match(
    setVisible,
    /PlaybackSurfaceMatches\([\s\S]*width, height, HWND_TOP\)[\s\S]*WindowContainsFocus\(hostWindow_\)/,
  );
  assert.match(
    setVisible,
    /StationheadTabKind::Auth[\s\S]*authController_ && authWebview_[\s\S]*ActiveAuthSurfaceMatches\([\s\S]*WindowContainsFocus\(authHostWindow_\)[\s\S]*return;/,
  );
});

test('fast-path helpers validate host placement, controller bounds and visibility', () => {
  const playbackMatches = section(
    layoutSource,
    'bool PlaybackSurfaceMatches(',
    'bool HiddenAuthSurfaceMatches(',
  );
  assert.match(playbackMatches, /WindowClientSizeMatches\(/);
  assert.match(playbackMatches, /ChildWindowPlacementMatches\(/);
  assert.match(playbackMatches, /ControllerBoundsMatch\(/);
  assert.match(playbackMatches, /ControllerVisibilityMatches\(controller, TRUE\)/);
  assert.match(
    playbackMatches,
    /controllerWidth =[\s\S]*workspaceBounds\.right - workspaceBounds\.left/,
  );
  assert.match(
    playbackMatches,
    /controllerHeight =[\s\S]*workspaceBounds\.bottom - workspaceBounds\.top/,
  );

  const activeAuthMatches = section(
    layoutSource,
    'bool ActiveAuthSurfaceMatches(',
    'bool ConfiguresSecondaryStationheadWindow(',
  );
  assert.match(activeAuthMatches, /playbackHidden/);
  assert.match(activeAuthMatches, /WindowClientSizeMatches\(authHostWindow/);
  assert.match(activeAuthMatches, /ChildWindowPlacementMatches\(authHostWindow/);
  assert.match(activeAuthMatches, /ControllerBoundsMatch\(authController/);
  assert.match(activeAuthMatches, /ControllerVisibilityMatches\(authController, TRUE\)/);
});

test('host resize is checked before synchronous WebView controller bounds reads', () => {
  const applyLayout = section(
    layoutSource,
    'void ApplyStationheadChildLayout(',
    '\n}\n\n}\n\nbool StationheadPlayer::EnsureHostWindow()',
  );
  const playbackHostCheck = applyLayout.indexOf(
    'WindowClientSizeMatches(hostWindow, hostWidth, hostHeight)',
  );
  const playbackControllerCheck = applyLayout.indexOf(
    'ControllerBoundsMatch(controller, contentBounds)',
  );
  const authHostCheck = applyLayout.indexOf(
    'WindowClientSizeMatches(authHostWindow, width, height)',
  );
  const authControllerCheck = applyLayout.indexOf(
    'ControllerBoundsMatch(authController, authBounds)',
  );
  assert.ok(playbackHostCheck >= 0 && playbackHostCheck < playbackControllerCheck);
  assert.ok(authHostCheck >= 0 && authHostCheck < authControllerCheck);
});

test('layout reuses host size reads before controller bounds repair', () => {
  const applyLayout = section(
    layoutSource,
    'void ApplyStationheadChildLayout(',
    '\n}\n\n}\n\nbool StationheadPlayer::EnsureHostWindow()',
  );
  assert.equal(
    (applyLayout.match(/WindowClientSizeMatches\(hostWindow, hostWidth, hostHeight\)/g) ?? []).length,
    1,
  );
  assert.equal(
    (applyLayout.match(/WindowClientSizeMatches\(authHostWindow, width, height\)/g) ?? []).length,
    1,
  );
  assert.match(
    applyLayout,
    /const bool hostSizeMatches[\s\S]*\(!hostSizeMatches \|\| !hostPlacementMatches\)[\s\S]*if \(!ControllerBoundsMatch\(controller, contentBounds\)\)/,
  );
  assert.match(
    applyLayout,
    /const bool authHostSizeMatches[\s\S]*\(!authHostSizeMatches \|\| !authHostPlacementMatches\)[\s\S]*if \(!authHostSizeMatches \|\|[\s\S]*ControllerBoundsMatch\(authController, authBounds\)/,
  );
});
