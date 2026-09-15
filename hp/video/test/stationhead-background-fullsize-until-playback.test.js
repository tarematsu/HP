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

test('Stationhead keeps a 480x270 surface until playback is established', () => {
  assert.match(layout, /kStationheadBackgroundWidth = 480/);
  assert.match(layout, /kStationheadBackgroundHeight = 270/);
  const bounds = section(
    layout,
    'RECT ResolveStationheadBackgroundBounds(',
    'bool PlaybackSurfaceMatches(',
  );
  assert.match(bounds, /std::min\(kStationheadBackgroundWidth, width\)/);
  assert.match(bounds, /std::min\(kStationheadBackgroundHeight, height\)/);

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
    /keepPlaybackFullSizeInBackground[\s\S]*ResolveStationheadBackgroundBounds\(bounds_\)/,
  );
  assert.doesNotMatch(
    keepBehind,
    /!monitorForeground && keepPlaybackFullSizeInBackground/,
  );
});

test('playback size has only 480x270 pre-confirmation and 1x1 post-confirmation states', () => {
  const apply = section(
    layout,
    'void ApplyStationheadChildLayout(',
    '}\n\n}\n\nbool StationheadPlayer::EnsureHostWindow()',
  );
  assert.match(
    apply,
    /playbackFullSize\s*=\s*keepPlaybackFullSizeInBackground && !showAuth && !hidePlayback/,
  );
  assert.match(apply, /hostWidth = playbackFullSize \? width : 1/);
  assert.match(apply, /hostHeight = playbackFullSize \? height : 1/);
  assert.match(apply, /hostPlacement = playbackForeground \? HWND_TOP : HWND_BOTTOM/);
  assert.doesNotMatch(apply, /playbackFullSize = playbackForeground \|\|/);

  const layoutControllers = section(
    layout,
    'void StationheadPlayer::LayoutControllers()',
    'void StationheadPlayer::SetBounds(',
  );
  assert.match(
    layoutControllers,
    /selectedTab_ != StationheadTabKind::Auth &&[\s\S]*keepPlaybackFullSizeInBackground[\s\S]*ResolveStationheadBackgroundBounds\(bounds_\)/,
  );
});

test('monitor routing may change z-order but not Stationhead playback dimensions', () => {
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

test('confirmed playback stays 1x1 even when Monitor B is foreground', () => {
  const setVisible = section(
    layout,
    'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()',
  );
  assert.match(
    setVisible,
    /const bool playbackFullSize = keepPlaybackFullSizeInBackground;/,
  );
  assert.match(
    setVisible,
    /keepPlaybackFullSizeInBackground[\s\S]*ResolveStationheadBackgroundBounds\(bounds_\)/,
  );
  assert.match(setVisible, /monitorForeground \? HWND_TOP : nullptr/);
  assert.doesNotMatch(
    setVisible,
    /playbackFullSize =\s*monitorForeground \|\| keepPlaybackFullSizeInBackground/,
  );

  const surfaceMatch = section(
    layout,
    'bool PlaybackSurfaceMatches(',
    'bool BackgroundAuthSurfaceMatches(',
  );
  assert.match(surfaceMatch, /hostWidth > 1 \|\| hostHeight > 1/);
});
