import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layoutSource = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
  'utf8',
);
const bridgeSource = readFileSync(
  new URL('../../native/src/stationhead_monitor_probe.h', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('startup preview keeps Stationhead backgrounded unless an explicit foreground condition applies', () => {
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
});

test('background rendering keeps a real full-client Stationhead host behind the dashboard', () => {
  assert.match(bridgeSource, /StationheadBackgroundBounds\(const RECT& workspaceBounds\)[\s\S]*return workspaceBounds;/);
  assert.doesNotMatch(bridgeSource, /kStationheadSurfaceWidth|kStationheadSurfaceHeight|ComputeMediaSurfaceAnchors|anchors\.clock|CenterMediaSurfaceOnAnchor/);
  assert.doesNotMatch(bridgeSource, /StationheadOffscreenBounds|kStationheadOffscreenGap/);

  const createHost = section(
    layoutSource,
    'HWND CreateStationheadChildHost(',
    'bool WindowClientSizeMatches(',
  );
  assert.match(createHost, /StationheadBackgroundBounds\(bounds\)/);
  assert.match(createHost, /RectWidth\(background\), RectHeight\(background\)/);
  assert.doesNotMatch(createHost, /Offscreen/);

  const applyLayout = section(
    layoutSource,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(applyLayout, /const RECT surfaceBounds = StationheadBackgroundBounds\(workspaceBounds\)/);
  assert.match(applyLayout, /playbackHostBounds = surfaceBounds/);
  assert.match(applyLayout, /authHostBounds = surfaceBounds/);
  assert.match(applyLayout, /controller->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(applyLayout, /StationheadOffscreenBounds|authOffscreen/);
  assert.doesNotMatch(applyLayout, /hostWidth = .*\? .* : 1/);
  assert.doesNotMatch(applyLayout, /put_IsVisible\(FALSE\)/);
});

test('normal background state stays in the client area and may compact only the controller', () => {
  const keepBehind = section(
    layoutSource,
    'void StationheadPlayer::KeepPlaybackBehindDashboard()',
    'void StationheadPlayer::SetStartupBounds()',
  );
  assert.match(keepBehind, /selectedTab_ = StationheadTabKind::None/);
  assert.match(
    keepBehind,
    /ApplyStationheadChildLayout\([\s\S]*false, false, false, compactPlayback\)/,
  );

  const applyLayout = section(
    layoutSource,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(applyLayout, /StationheadBackgroundBounds\(workspaceBounds\)/);
  assert.match(applyLayout, /hostPlacement = playbackForeground \? HWND_TOP : HWND_BOTTOM/);
  assert.match(applyLayout, /PlaybackControllerBounds\(playbackHostBounds, useCompactPlayback\)/);
  assert.match(
    applyLayout,
    /SetWindowPos\(hostWindow, hostPlacement,[\s\S]*playbackHostBounds\.left, playbackHostBounds\.top/,
  );
});

test('Monitor B and explicit Stationhead presentation promote the full-client surface and controller', () => {
  const applyLayout = section(
    layoutSource,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(applyLayout, /const bool monitorForeground = StationheadMonitorForeground\(\)/);
  assert.match(
    applyLayout,
    /showPlayback \|\| \(!showAuth && !hidePlayback && monitorForeground\)/,
  );
  assert.match(applyLayout, /useCompactPlayback =\s*compactPlayback && !playbackForeground/);
  assert.match(applyLayout, /playbackHostBounds = surfaceBounds/);
  assert.match(applyLayout, /hostPlacement = playbackForeground \? HWND_TOP : HWND_BOTTOM/);
  assert.doesNotMatch(applyLayout, /playbackHostBounds = playbackForeground \? workspaceBounds/);

  const visible = section(
    layoutSource,
    'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()',
  );
  assert.match(visible, /StationheadBackgroundBounds\(bounds_\)/);
  assert.match(visible, /!monitorForeground/);
  assert.match(visible, /HWND_TOP/);
});

test('authentication uses the same full-client onscreen surface and foreground z-order', () => {
  const applyLayout = section(
    layoutSource,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(applyLayout, /authHostBounds = surfaceBounds/);
  assert.match(applyLayout, /authPlacement = showAuth \? HWND_TOP : HWND_BOTTOM/);
  assert.doesNotMatch(applyLayout, /StationheadOffscreenBounds|authOffscreen/);

  const activeAuth = section(
    layoutSource,
    'bool ActiveAuthSurfaceMatches(',
    'RECT ResolveStationheadWorkspaceBounds(',
  );
  assert.match(activeAuth, /StationheadBackgroundBounds\(workspaceBounds\)/);
  assert.match(activeAuth, /SurfaceMatches\(hostWindow, controller, surface, HWND_BOTTOM\)/);
  assert.match(activeAuth, /SurfaceMatches\(authHostWindow, authController, surface, HWND_TOP\)/);
});

test('adaptive layout requires stable playback but startup and navigation restore full viewport', () => {
  const keepBehind = section(
    layoutSource,
    'void StationheadPlayer::KeepPlaybackBehindDashboard()',
    'void StationheadPlayer::SetStartupBounds()',
  );
  const layout = section(
    layoutSource,
    'void StationheadPlayer::LayoutControllers()',
    'void StationheadPlayer::SetBounds(',
  );
  for (const source of [keepBehind, layout]) {
    assert.match(source, /AudioPlayingSince\(\)/);
    assert.match(source, /kStationheadCompactPlaybackStabilityMs/);
    assert.match(source, /navigationInFlight_/);
    assert.match(source, /recreating_/);
  }

  const startup = section(
    layoutSource,
    'void StationheadPlayer::SetStartupBounds()',
    'void StationheadPlayer::SetStartupPreviewBounds(',
  );
  assert.match(startup, /false, false, false, false/);
  assert.doesNotMatch(startup, /AudioPlaying|compactPlayback/);
});
