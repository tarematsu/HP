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

test('background, startup and reload all keep the full playback viewport', () => {
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
  assert.match(startup, /ApplyStationheadChildLayout\([\s\S]*false, false, false\)/);
  assert.doesNotMatch(startup, /AudioPlaying|compactPlayback/);

  const apply = section(
    layout,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(apply, /const RECT playbackControllerBounds\{0, 0, playbackWidth, playbackHeight\};/);
  assert.doesNotMatch(apply, /PlaybackControllerBounds|compactPlayback|useCompactPlayback/);
});

test('Monitor B changes Stationhead z-order without changing full-client controller geometry', () => {
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
  assert.doesNotMatch(apply, /compactPlayback|useCompactPlayback/);
  assert.doesNotMatch(apply, /playbackHostBounds = playbackForeground \? workspaceBounds/);

  const placement = section(
    routing,
    'void PowerSavingController::ApplyStationheadMonitorPlacement() noexcept',
    'void PowerSavingController::Detach() noexcept',
  );
  assert.match(placement, /monitorMode_ == MonitorMode::Stationhead/);
  assert.match(placement, /StationheadPlayer exclusively owns the/);
  assert.match(placement, /if \(context->stationheadForeground\)/);
  assert.match(placement, /SWP_NOMOVE \| SWP_NOSIZE \| SWP_NOACTIVATE \| SWP_SHOWWINDOW/);
  assert.doesNotMatch(placement, /foregroundBounds/);
  assert.match(placement, /child, HWND_BOTTOM/);
});

test('authentication keeps playback alive onscreen behind the full-client foreground auth surface', () => {
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
