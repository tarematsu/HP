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

test('Stationhead normal background surface stays 160x320 behind the clock panel', () => {
  assert.match(bridge, /kStationheadSurfaceWidth = 160/);
  assert.match(bridge, /kStationheadSurfaceHeight = 320/);
  assert.match(bridge, /StationheadBackgroundBounds/);
  assert.match(bridge, /ComputeMediaSurfaceAnchors\(workspaceBounds\)/);
  assert.match(bridge, /anchors\.clock/);
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

test('Monitor B changes Stationhead z-order only and preserves the 160x320 geometry', () => {
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
  assert.match(apply, /playbackHostBounds = surfaceBounds/);
  assert.match(apply, /hostPlacement = playbackForeground \? HWND_TOP : HWND_BOTTOM/);
  assert.doesNotMatch(apply, /playbackHostBounds = playbackForeground \? workspaceBounds/);

  const placement = section(
    routing,
    'void PowerSavingController::ApplyStationheadMonitorPlacement() noexcept',
    'void PowerSavingController::Detach() noexcept',
  );
  assert.match(placement, /monitorMode_ == MonitorMode::Stationhead/);
  assert.match(placement, /StationheadPlayer exclusively owns the fixed/);
  assert.match(placement, /if \(context->stationheadForeground\)/);
  assert.match(placement, /SWP_NOMOVE \| SWP_NOSIZE \| SWP_NOACTIVATE \| SWP_SHOWWINDOW/);
  assert.doesNotMatch(placement, /foregroundBounds/);
  assert.match(placement, /child, HWND_BOTTOM/);
});

test('authentication keeps playback alive onscreen behind the 160x320 foreground auth surface', () => {
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
  assert.match(activeAuth, /SurfaceMatches\(authHostWindow, authController, surface, HWND_TOP\)/);
});
