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

test('startup preview lifecycle keeps the playback host at 1x1 and HWND_BOTTOM', () => {
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
  assert.match(
    setPreviewBounds,
    /startupPreviewActive_ && EqualRect\(&bounds_, &bounds\)/,
  );
  assert.match(
    setPreviewBounds,
    /PlaybackSurfaceMatches\([\s\S]*1, 1, HWND_BOTTOM\)/,
  );
  assert.match(setPreviewBounds, /HiddenAuthSurfaceMatches\(/);
  assert.match(setPreviewBounds, /KeepPlaybackBehindDashboard\(\)/);
  assert.doesNotMatch(setPreviewBounds, /HWND_TOP|showStartupPreview/);
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

test('reselecting playback stays background-only while active auth may reuse its surface', () => {
  const setVisible = section(
    layoutSource,
    'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()',
  );
  assert.match(
    setVisible,
    /selectedTab_ != StationheadTabKind::Auth[\s\S]*KeepPlaybackBehindDashboard\(\)[\s\S]*return;/,
  );
  assert.doesNotMatch(
    setVisible,
    /StationheadTabKind::Stationhead[\s\S]*PlaybackSurfaceMatches\([\s\S]*HWND_TOP/,
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
    /const bool hostSizeMatches[\s\S]*\(!hostSizeMatches \|\| !hostPlacementMatches\)[\s\S]*if \(!hostSizeMatches \|\|[\s\S]*ControllerBoundsMatch\(controller, contentBounds\)/,
  );
  assert.match(
    applyLayout,
    /const bool authHostSizeMatches[\s\S]*\(!authHostSizeMatches \|\| !authHostPlacementMatches\)[\s\S]*if \(!authHostSizeMatches \|\|[\s\S]*ControllerBoundsMatch\(authController, authBounds\)/,
  );
});
