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

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing section start: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `missing section end: ${end}`);
  return source.slice(from, to);
}

test('Stationhead keeps a media-panel-sized background surface until initial playback is established', () => {
  const keepBehind = section(
    layout,
    'void StationheadPlayer::KeepPlaybackBehindDashboard()',
    'void StationheadPlayer::SetStartupBounds()',
  );
  assert.match(
    keepBehind,
    /trackBoundaryPlaybackRecoveryPending_\s*\|\|\s*\(!AudioPlaying\(\) && !audioLossPlaybackObserved_\)/,
  );
  assert.match(
    keepBehind,
    /ApplyStationheadChildLayout[\s\S]*keepPlaybackFullSizeInBackground/,
  );
});

test('startup and track-boundary recovery fit exactly behind the YouTube/TVer media panel', () => {
  const resolver = section(
    layout,
    'RECT ResolveStationheadBackgroundBounds(',
    'bool PlaybackSurfaceMatches(',
  );
  assert.match(
    resolver,
    /FindWindowExW\([\s\S]*L"HomePanelNativeStaticPanel"[\s\S]*L"HomePanelNativeMedia"/,
  );
  assert.match(resolver, /GetWindowRect\(mediaWindow, &screenRect\)/);
  assert.match(resolver, /ScreenToClient\(parent, &topLeft\)/);
  assert.match(resolver, /ScreenToClient\(parent, &bottomRight\)/);

  const apply = section(
    layout,
    'void ApplyStationheadChildLayout(',
    '}\n\n}\n\nbool StationheadPlayer::EnsureHostWindow()',
  );
  assert.match(
    apply,
    /playbackBackgroundFullSize\s*=\s*keepPlaybackFullSizeInBackground && !showAuth && !hidePlayback &&\s*!playbackForeground/,
  );
  assert.match(apply, /playbackFullSize\s*=\s*playbackForeground \|\| playbackBackgroundFullSize/);
  assert.match(
    apply,
    /playbackBackgroundFullSize[\s\S]*ResolveStationheadBackgroundBounds\(hostWindow, bounds\)/,
  );
  assert.match(apply, /hostWidth = playbackFullSize \? playbackWidth : 1/);
  assert.match(apply, /hostHeight = playbackFullSize \? playbackHeight : 1/);
  assert.match(apply, /hostPlacement = playbackForeground \? HWND_TOP : HWND_BOTTOM/);
  assert.match(apply, /playbackControllerVisible\s*=\s*playbackFullSize \|\|/);
  assert.match(
    apply,
    /const RECT hostBounds\{playbackBounds\.left, playbackBounds\.top,[\s\S]*playbackBounds\.left \+ hostWidth,[\s\S]*playbackBounds\.top \+ hostHeight\}/,
  );
  assert.match(
    apply,
    /ChildWindowPlacementMatches\(\s*hostWindow, hostBounds, playbackForeground \? HWND_TOP : nullptr\)/,
  );
  assert.match(
    apply,
    /SetWindowPos\(hostWindow, hostPlacement, hostBounds\.left, hostBounds\.top/,
  );
});

test('monitor routing preserves player-owned background size while forcing Stationhead behind the dashboard', () => {
  const placement = section(
    routing,
    'void PowerSavingController::ApplyStationheadMonitorPlacement() noexcept',
    'void PowerSavingController::Detach() noexcept',
  );
  assert.match(
    placement,
    /if \(context->stationheadForeground\)[\s\S]*else \{[\s\S]*SetWindowPos\([\s\S]*child, HWND_BOTTOM,[\s\S]*SWP_NOMOVE \| SWP_NOSIZE/,
  );
  assert.doesNotMatch(
    placement,
    /IsStationheadPlaybackHost[\s\S]*backgroundBounds/,
  );
});

test('normal established playback still collapses to 1x1 in Monitor A while Monitor B stays foreground', () => {
  const setVisible = section(
    layout,
    'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()',
  );
  assert.match(
    setVisible,
    /const bool playbackFullSize =\s*monitorForeground \|\| keepPlaybackFullSizeInBackground/,
  );
  assert.match(
    setVisible,
    /!monitorForeground && keepPlaybackFullSizeInBackground[\s\S]*ResolveStationheadBackgroundBounds\(hostWindow_, bounds_\)/,
  );
  assert.match(setVisible, /monitorForeground \? HWND_TOP : nullptr/);

  const surfaceMatch = section(
    layout,
    'bool PlaybackSurfaceMatches(',
    'bool BackgroundAuthSurfaceMatches(',
  );
  assert.match(surfaceMatch, /hostWidth > 1 \|\| hostHeight > 1/);
});
