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

test('normal background keeps 360x960 while the selected named monitor expands', () => {
  const keepBehind = section(
    layoutSource,
    'void StationheadPlayer::KeepPlaybackBehindDashboard()',
    'void StationheadPlayer::SetStartupBounds()',
  );
  assert.match(keepBehind, /selectedTab_ = StationheadTabKind::None/);
  assert.match(
    keepBehind,
    /ApplyStationheadChildLayout\([\s\S]*false, false, false,[\s\S]*StationheadMonitorForegroundForProfile\(profileName_\)\)/,
  );
  assert.doesNotMatch(keepBehind, /AudioPlayingSince|compactPlayback|kStationheadCompactPlayback/);

  const applyLayout = section(
    layoutSource,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(applyLayout, /StationheadBackgroundBounds\(workspaceBounds\)/);
  assert.match(applyLayout, /hostPlacement = playbackForeground \? HWND_TOP : HWND_BOTTOM/);
  assert.match(
    applyLayout,
    /const RECT playbackControllerBounds = monitorForeground[\s\S]*RECT\{0, 0, playbackWidth, playbackHeight\}[\s\S]*StationheadPlaybackControllerBounds\(\)/,
  );
  assert.match(layoutSource, /kStationheadPlaybackViewportWidth = 360/);
  assert.match(layoutSource, /kStationheadPlaybackViewportHeight = 960/);
  assert.doesNotMatch(applyLayout, /compactPlayback|useCompactPlayback/);
  assert.match(
    applyLayout,
    /SetWindowPos\(hostWindow, hostPlacement,[\s\S]*playbackHostBounds\.left, playbackHostBounds\.top/,
  );
});

test('explicit Stationhead presentation stays fixed while named monitor may use full playback viewport', () => {
  const applyLayout = section(
    layoutSource,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(applyLayout, /bool monitorForeground/);
  assert.match(layoutSource, /StationheadMonitorForegroundForProfile\(profileName_\)/);
  assert.match(
    applyLayout,
    /showPlayback \|\| \(!showAuth && !hidePlayback && monitorForeground\)/,
  );
  assert.match(applyLayout, /playbackHostBounds = surfaceBounds/);
  assert.match(applyLayout, /hostPlacement = playbackForeground \? HWND_TOP : HWND_BOTTOM/);
  assert.match(
    applyLayout,
    /monitorForeground[\s\S]*RECT\{0, 0, playbackWidth, playbackHeight\}[\s\S]*StationheadPlaybackControllerBounds\(\)/,
  );
  assert.doesNotMatch(applyLayout, /compactPlayback|useCompactPlayback/);
  assert.doesNotMatch(applyLayout, /playbackHostBounds = playbackForeground \? workspaceBounds/);

  const visible = section(
    layoutSource,
    'void StationheadPlayer::SetVisible(bool visible)',
    'void StationheadPlayer::LayoutControllers()',
  );
  assert.match(visible, /StationheadBackgroundBounds\(bounds_\)/);
  assert.match(visible, /HWND_TOP/);
});

test('authentication keeps its full-client auth viewport and background playback policy', () => {
  const applyLayout = section(
    layoutSource,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(applyLayout, /authHostBounds = surfaceBounds/);
  assert.match(applyLayout, /authPlacement = showAuth \? HWND_TOP : HWND_BOTTOM/);
  assert.match(applyLayout, /const RECT authControllerBounds\{0, 0, authWidth, authHeight\};/);
  assert.doesNotMatch(applyLayout, /StationheadOffscreenBounds|authOffscreen/);

  const activeAuth = section(
    layoutSource,
    'bool ActiveAuthSurfaceMatches(',
    'RECT ResolveStationheadWorkspaceBounds(',
  );
  assert.match(activeAuth, /StationheadBackgroundBounds\(workspaceBounds\)/);
  assert.match(activeAuth, /SurfaceMatches\(hostWindow, controller, surface, HWND_BOTTOM\)/);
  assert.match(activeAuth, /SurfaceMatches\(authHostWindow, authController, surface, HWND_TOP, false\)/);
});

test('playback viewport no longer depends on stable-audio or navigation state', () => {
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
    assert.doesNotMatch(source, /AudioPlayingSince\(\)|kStationheadCompactPlayback|compactPlayback/);
    assert.doesNotMatch(source, /navigationInFlight_|recreating_/);
  }

  const startup = section(
    layoutSource,
    'void StationheadPlayer::SetStartupBounds()',
    'void StationheadPlayer::SetStartupPreviewBounds(',
  );
  assert.match(startup, /false, false, false/);
  assert.doesNotMatch(startup, /AudioPlaying|compactPlayback/);
});
