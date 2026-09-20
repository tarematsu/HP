import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
  'utf8',
);
const routing = readFileSync(
  new URL('../../native/src/power_saving_window_routing.inc', import.meta.url),
  'utf8',
);
const bridge = readFileSync(
  new URL('../../native/src/stationhead_monitor_probe.h', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing section start: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `missing section end: ${end}`);
  return source.slice(from, to);
}

test('Stationhead normal background host fills the client area behind the dashboard', () => {
  assert.match(bridge, /StationheadBackgroundBounds\(const RECT& workspaceBounds\)[\s\S]*return workspaceBounds;/);
  assert.doesNotMatch(bridge, /kStationheadSurfaceWidth|kStationheadSurfaceHeight|ComputeMediaSurfaceAnchors|anchors\.clock|CenterMediaSurfaceOnAnchor/);
  assert.doesNotMatch(bridge, /StationheadOffscreenBounds|kStationheadOffscreenGap/);

  const apply = section(
    layout,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(apply, /const RECT surfaceBounds = StationheadBackgroundBounds\(workspaceBounds\)/);
  assert.match(apply, /playbackHostBounds = surfaceBounds/);
  assert.match(apply, /authHostBounds = surfaceBounds/);
  assert.doesNotMatch(apply, /StationheadOffscreenBounds|authOffscreen/);
});

test('background, startup and reload all keep the fixed 360x960 playback viewport', () => {
  const keepBehind = section(
    layout,
    'void StationheadPlayer::KeepPlaybackBehindDashboard()',
    'void StationheadPlayer::SetStartupBounds()',
  );
  assert.match(keepBehind, /selectedTab_ = StationheadTabKind::None/);
  assert.match(keepBehind, /false, false, false/);
  assert.doesNotMatch(keepBehind, /AudioPlayingSince\(\)|kStationheadCompactPlayback|compactPlayback/);

  const startup = section(
    layout,
    'void StationheadPlayer::SetStartupBounds()',
    'void StationheadPlayer::SetStartupPreviewBounds(',
  );
  assert.match(startup, /selectedTab_ = StationheadTabKind::None/);
  assert.match(
    startup,
    /ApplyStationheadChildLayout\([\s\S]*false, false, false,[\s\S]*StationheadMonitorForegroundForProfile\(profileName_\)\)/,
  );
  assert.doesNotMatch(startup, /AudioPlaying|compactPlayback/);

  const apply = section(
    layout,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(layout, /kStationheadPlaybackViewportWidth = 360/);
  assert.match(layout, /kStationheadPlaybackViewportHeight = 960/);
  assert.match(apply, /const RECT playbackControllerBounds = StationheadPlaybackControllerBounds\(\);/);
  assert.doesNotMatch(apply, /compactPlayback|useCompactPlayback/);
});

test('named Stationhead monitor promotes only the selected playback host', () => {
  const apply = section(
    layout,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(apply, /bool monitorForeground/);
  assert.match(
    apply,
    /playbackForeground\s*=\s*[\s\S]*showPlayback \|\| \(!showAuth && !hidePlayback && monitorForeground\)/,
  );
  assert.match(apply, /StationheadPlaybackControllerBounds\(\)/);

  const placement = section(
    routing,
    'void PowerSavingController::ApplyStationheadMonitorPlacement() noexcept',
    'void PowerSavingController::Detach() noexcept',
  );
  assert.match(placement, /monitorMode_ == MonitorMode::ServiceGrid \? monitorStationheadProfile_ : 0/);
  assert.match(placement, /StationheadProfileNumberFromWindow\(child\) != context->selectedProfile/);
  assert.match(placement, /SetStationheadMonitorProfile\(selectedProfile\)/);
  assert.match(placement, /const HWND insertAfter = controller->overlay_/);
  assert.match(placement, /SetWindowPos\([\s\S]*target\.left, target\.top/);
});

test('authentication keeps playback alive behind the full-client auth surface', () => {
  const apply = section(
    layout,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(apply, /playbackHostBounds = surfaceBounds/);
  assert.match(apply, /authHostBounds = surfaceBounds/);
  assert.match(apply, /authPlacement = showAuth \? HWND_TOP : HWND_BOTTOM/);
  assert.doesNotMatch(apply, /StationheadOffscreenBounds|authOffscreen/);

  const activeAuth = section(
    layout,
    'bool ActiveAuthSurfaceMatches(',
    'RECT ResolveStationheadWorkspaceBounds(',
  );
  assert.match(activeAuth, /StationheadBackgroundBounds\(workspaceBounds\)/);
  assert.match(activeAuth, /SurfaceMatches\(hostWindow, controller, surface, HWND_BOTTOM\)/);
  assert.match(activeAuth, /SurfaceMatches\(authHostWindow, authController, surface, HWND_TOP, false\)/);
});
