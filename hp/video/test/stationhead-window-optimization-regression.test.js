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

test('background rendering never collapses Stationhead to 1x1', () => {
  assert.match(bridgeSource, /kStationheadSurfaceWidth = 480/);
  assert.match(bridgeSource, /kStationheadSurfaceHeight = 270/);
  assert.match(bridgeSource, /StationheadBackgroundBounds/);
  assert.match(bridgeSource, /StationheadOffscreenBounds/);

  const createHost = section(
    layoutSource,
    'HWND CreateStationheadChildHost(',
    'bool WindowClientSizeMatches(',
  );
  assert.match(createHost, /StationheadOffscreenBounds\(bounds\)/);
  assert.match(createHost, /kStationheadSurfaceWidth, kStationheadSurfaceHeight/);

  const applyLayout = section(
    layoutSource,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(applyLayout, /const RECT authOffscreen = StationheadOffscreenBounds\(workspaceBounds\)/);
  assert.match(applyLayout, /const RECT offscreen = hidePlayback[\s\S]*StationheadBackgroundBounds\(workspaceBounds\)/);
  assert.match(applyLayout, /playbackHostBounds = playbackForeground \? workspaceBounds : offscreen/);
  assert.match(applyLayout, /controller->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(applyLayout, /hostWidth = .*\? .* : 1/);
  assert.doesNotMatch(applyLayout, /put_IsVisible\(FALSE\)/);
});

test('normal background state stays in the client area behind the dashboard', () => {
  const keepBehind = section(
    layoutSource,
    'void StationheadPlayer::KeepPlaybackBehindDashboard()',
    'void StationheadPlayer::SetStartupBounds()',
  );
  assert.match(keepBehind, /selectedTab_ = StationheadTabKind::None/);
  assert.match(
    keepBehind,
    /ApplyStationheadChildLayout\([\s\S]*false, false, false\)/,
  );

  const applyLayout = section(
    layoutSource,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(applyLayout, /StationheadBackgroundBounds\(workspaceBounds\)/);
  assert.match(applyLayout, /hostPlacement = playbackForeground \? HWND_TOP : HWND_BOTTOM/);
  assert.match(
    applyLayout,
    /SetWindowPos\(hostWindow, hostPlacement,[\s\S]*playbackHostBounds\.left, playbackHostBounds\.top/,
  );
});

test('Monitor B and explicit Stationhead presentation use the full workspace', () => {
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
  assert.match(applyLayout, /playbackHostBounds = playbackForeground \? workspaceBounds : offscreen/);

  const visible = section(
    layoutSource,
    'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()',
  );
  assert.match(
    visible,
    /SurfaceMatches\(hostWindow_, controller_\.Get\(\), bounds_, HWND_TOP\)/,
  );
});

test('authentication uses a fullscreen foreground surface and parks playback offscreen', () => {
  const applyLayout = section(
    layoutSource,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(applyLayout, /const RECT authOffscreen = StationheadOffscreenBounds\(workspaceBounds\)/);
  assert.match(applyLayout, /const RECT offscreen = hidePlayback[\s\S]*authOffscreen/);
  assert.match(applyLayout, /authHostBounds = showAuth \? workspaceBounds : offscreen/);
  assert.match(applyLayout, /authPlacement = showAuth \? HWND_TOP : HWND_BOTTOM/);

  const activeAuth = section(
    layoutSource,
    'bool ActiveAuthSurfaceMatches(',
    'RECT ResolveStationheadWorkspaceBounds(',
  );
  assert.match(activeAuth, /SurfaceMatches\(hostWindow, controller, offscreen, nullptr\)/);
  assert.match(activeAuth, /SurfaceMatches\(authHostWindow, authController, workspaceBounds, HWND_TOP\)/);
});

test('layout decisions no longer depend on playback audio confirmation', () => {
  const keepBehind = section(
    layoutSource,
    'void StationheadPlayer::KeepPlaybackBehindDashboard()',
    'void StationheadPlayer::SetStartupBounds()',
  );
  const visible = section(
    layoutSource,
    'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()',
  );
  const layout = section(
    layoutSource,
    'void StationheadPlayer::LayoutControllers()',
    'void StationheadPlayer::SetBounds(',
  );

  for (const source of [keepBehind, visible, layout]) {
    assert.doesNotMatch(source, /AudioPlaying/);
    assert.doesNotMatch(source, /audioLossPlaybackObserved_/);
    assert.doesNotMatch(source, /trackBoundaryPlaybackRecoveryPending_/);
  }
});
