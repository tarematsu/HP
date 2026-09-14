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

test('background playback shrinks HWND and WebView controller to 1x1 and may suppress rendering', () => {
  const applyLayout = section(
    layoutSource,
    'void ApplyStationheadChildLayout(',
    '\n}\n\n}\n\nbool StationheadPlayer::EnsureHostWindow()',
  );
  assert.match(applyLayout, /const bool playbackForeground =/);
  assert.match(applyLayout, /const int hostWidth = playbackForeground \? width : 1;/);
  assert.match(applyLayout, /const int hostHeight = playbackForeground \? height : 1;/);
  assert.match(applyLayout, /const RECT contentBounds\{0, 0, hostWidth, hostHeight\};/);
  assert.match(
    applyLayout,
    /SetWindowPos\(hostWindow, hostPlacement,[\s\S]*hostWidth, hostHeight,[\s\S]*SWP_SHOWWINDOW/,
  );
  assert.match(applyLayout, /controller->put_Bounds\(contentBounds\);/);
  assert.match(
    applyLayout,
    /const BOOL playbackControllerVisible\s*=\s*playbackForeground \|\|\s*!StationheadPlaybackRenderingSuppressed\(controller\)/,
  );
  assert.match(applyLayout, /controller->put_IsVisible\(playbackControllerVisible\);/);
});

test('background auth WebView also stays visible at 1x1', () => {
  const applyLayout = section(
    layoutSource,
    'void ApplyStationheadChildLayout(',
    '\n}\n\n}\n\nbool StationheadPlayer::EnsureHostWindow()',
  );
  assert.match(applyLayout, /const int authHostWidth = showAuth \? width : 1;/);
  assert.match(applyLayout, /const int authHostHeight = showAuth \? height : 1;/);
  assert.match(applyLayout, /const RECT authBounds\{0, 0, authHostWidth, authHostHeight\};/);
  assert.match(applyLayout, /authController->put_IsVisible\(TRUE\);/);
  assert.doesNotMatch(applyLayout, /authController->put_IsVisible\(FALSE\)/);
  assert.doesNotMatch(applyLayout, /ShowWindow\([^\n]*SW_HIDE/);
});

test('duplicate background notifications verify 1x1 monitor placement and auth surface', () => {
  const setVisible = section(
    layoutSource,
    'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()',
  );
  assert.match(setVisible, /const bool monitorForeground = StationheadMonitorForeground\(\);/);
  assert.match(
    setVisible,
    /PlaybackSurfaceMatches\([\s\S]*monitorForeground \? std::max[\s\S]*monitorForeground \? HWND_TOP : nullptr\)[\s\S]*BackgroundAuthSurfaceMatches\([\s\S]*return;/,
  );
  assert.match(setVisible, /const bool hadInteractiveSurface/);
  assert.match(setVisible, /const bool interactiveSurfaceHadFocus/);
});

test('explicit Stationhead interaction may expand the playback surface', () => {
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

test('fast-path helpers validate controller size and the expected render state together', () => {
  const playbackMatches = section(
    layoutSource,
    'bool PlaybackSurfaceMatches(',
    'bool BackgroundAuthSurfaceMatches(',
  );
  assert.match(playbackMatches, /WindowClientSizeMatches\(/);
  assert.match(playbackMatches, /ChildWindowPlacementMatches\(/);
  assert.match(playbackMatches, /ControllerBoundsMatch\(/);
  assert.match(playbackMatches, /const BOOL expectedVisibility/);
  assert.match(playbackMatches, /StationheadPlaybackRenderingSuppressed\(controller\)/);
  assert.match(playbackMatches, /ControllerVisibilityMatches\(controller, expectedVisibility\)/);
  assert.match(playbackMatches, /const RECT controllerBounds\{0, 0, hostWidth, hostHeight\};/);

  const activeAuthMatches = section(
    layoutSource,
    'bool ActiveAuthSurfaceMatches(',
    'bool ConfiguresSecondaryStationheadWindow(',
  );
  assert.match(activeAuthMatches, /playbackBackground/);
  assert.match(activeAuthMatches, /WindowClientSizeMatches\(hostWindow, 1, 1\)/);
  assert.match(activeAuthMatches, /ControllerBoundsMatch\(controller, RECT\{0, 0, 1, 1\}\)/);
  assert.match(activeAuthMatches, /const BOOL playbackVisibility/);
  assert.match(activeAuthMatches, /ControllerVisibilityMatches\(controller, playbackVisibility\)/);
  assert.match(activeAuthMatches, /ControllerVisibilityMatches\(authController, TRUE\)/);
});
