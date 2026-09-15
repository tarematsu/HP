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

test('Stationhead background surface is always 480x270 and offscreen', () => {
  assert.match(bridge, /kStationheadSurfaceWidth = 480/);
  assert.match(bridge, /kStationheadSurfaceHeight = 270/);
  assert.match(bridge, /StationheadOffscreenBounds/);
  assert.match(bridge, /workspaceBounds\.right \+ kStationheadOffscreenGap/);

  const createHost = section(
    layout,
    'HWND CreateStationheadChildHost(',
    'bool WindowClientSizeMatches(',
  );
  assert.match(createHost, /StationheadOffscreenBounds\(bounds\)/);
  assert.match(createHost, /kStationheadSurfaceWidth, kStationheadSurfaceHeight/);
  assert.doesNotMatch(createHost, /, 1, 1,/);
});

test('normal startup and reload layout do not depend on audio confirmation', () => {
  const keepBehind = section(
    layout,
    'void StationheadPlayer::KeepPlaybackBehindDashboard()',
    'void StationheadPlayer::SetStartupBounds()',
  );
  assert.match(keepBehind, /selectedTab_ = StationheadTabKind::None/);
  assert.match(keepBehind, /ApplyStationheadChildLayout/);
  assert.doesNotMatch(keepBehind, /AudioPlaying/);
  assert.doesNotMatch(keepBehind, /audioLossPlaybackObserved_/);
  assert.doesNotMatch(keepBehind, /trackBoundaryPlaybackRecoveryPending_/);

  const startup = section(
    layout,
    'void StationheadPlayer::SetStartupBounds()',
    'void StationheadPlayer::SetStartupPreviewBounds(',
  );
  assert.match(startup, /selectedTab_ = StationheadTabKind::None/);
  assert.match(startup, /LayoutControllers\(\)/);
});

test('Monitor B presents Stationhead fullscreen and normal mode returns it offscreen', () => {
  const apply = section(
    layout,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(apply, /const bool monitorForeground = StationheadMonitorForeground\(\)/);
  assert.match(
    apply,
    /playbackForeground\s*=\s*[\s\S]*showPlayback \|\| \(!showAuth && !hidePlayback && monitorForeground\)/,
  );
  assert.match(apply, /playbackHostBounds = playbackForeground \? workspaceBounds : offscreen/);
  assert.match(apply, /hostPlacement = playbackForeground \? HWND_TOP : HWND_BOTTOM/);

  const placement = section(
    routing,
    'void PowerSavingController::ApplyStationheadMonitorPlacement() noexcept',
    'void PowerSavingController::Detach() noexcept',
  );
  assert.match(placement, /monitorMode_ == MonitorMode::Stationhead/);
  assert.match(
    placement,
    /if \(context->stationheadForeground\)[\s\S]*context->foregroundBounds[\s\S]*SWP_SHOWWINDOW/,
  );
  assert.match(placement, /child, HWND_BOTTOM/);
});

test('authentication is foreground fullscreen while playback remains a 480x270 offscreen surface', () => {
  const apply = section(
    layout,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(apply, /authHostBounds = showAuth \? workspaceBounds : offscreen/);
  assert.match(apply, /authPlacement = showAuth \? HWND_TOP : HWND_BOTTOM/);
  assert.match(apply, /playbackHostBounds = playbackForeground \? workspaceBounds : offscreen/);

  const activeAuth = section(
    layout,
    'bool ActiveAuthSurfaceMatches(',
    'RECT ResolveStationheadWorkspaceBounds(',
  );
  assert.match(activeAuth, /StationheadOffscreenBounds\(workspaceBounds\)/);
  assert.match(activeAuth, /SurfaceMatches\(hostWindow, controller, offscreen, nullptr\)/);
  assert.match(activeAuth, /SurfaceMatches\(authHostWindow, authController, workspaceBounds, HWND_TOP\)/);
});
