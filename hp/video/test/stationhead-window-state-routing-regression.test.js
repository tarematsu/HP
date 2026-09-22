import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const bridge = source('stationhead_monitor_probe.h');
const handles = source('app_stationhead_handles.cpp');
const layout = source('sh_layout.cpp');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section terminator: ${end}`);
  return text.slice(from, to);
}

test('Stationhead startup preview is armed before the deferred WebView start and stays fullscreen behind the dashboard', () => {
  assert.match(bridge, /gStationheadBackgroundPreview\{true\}/);
  assert.match(bridge, /StationheadBackgroundBounds\(const RECT& workspaceBounds\)[\s\S]*return workspaceBounds;/);
  assert.doesNotMatch(bridge, /ComputeMediaSurfaceAnchors|anchors\.clock|kStationheadSurfaceWidth|kStationheadSurfaceHeight|CenterMediaSurfaceOnAnchor/);
  assert.doesNotMatch(bridge, /StationheadOffscreenBounds|kStationheadOffscreenGap/);
});

test('initial startup keeps the in-client background preview armed through WebView creation', () => {
  const start = section(
    handles,
    'void StationheadHandleBase::Start()',
    'void StationheadHandleBase::Tick(',
  );
  assert.match(start, /SetStationheadBackgroundPreview\(true\)/);
  assert.ok(
    start.indexOf('SetStationheadBackgroundPreview(true)') <
      start.indexOf('player_->Start()'),
  );
});

test('stable audio retires the startup preview without a periodic-refresh rearm path', () => {
  const sync = section(
    handles,
    'void SyncStationheadBackgroundPreview(',
    'static_assert(',
  );
  assert.match(sync, /player\.AudioPlaying\(\) && !status\.navigating/);
  assert.match(sync, /!status\.loginRequired && !status\.spotifyAuthorization/);
  assert.match(sync, /SetStationheadBackgroundPreview\(false\)/);
  assert.doesNotMatch(sync, /SetStationheadBackgroundPreview\(true\)/);
  assert.doesNotMatch(handles, /IsStationheadPeriodicRefresh|kStationheadPeriodicRefreshDetail|50-minute periodic refresh/);
  assert.match(bridge, /StationheadBackgroundBounds/);
  assert.doesNotMatch(bridge, /StationheadOffscreenBounds/);

  const tick = section(
    handles,
    'void StationheadHandleBase::Tick(int64_t nowMs)',
    'void StationheadHandleBase::ShowAfterAudioStop()',
  );
  assert.match(tick, /player_->RecoverUnavailableAuthorization\(\);[\s\S]*SyncStationheadBackgroundPreview/);
  assert.match(tick, /player_->EvaluateAudioLossRecovery\(nowMs\);[\s\S]*SyncStationheadBackgroundPreview/);

  const changes = section(
    handles,
    'uint32_t StationheadHandleBase::ConsumeChangeFlags()',
    'void StationheadHandleBase::AssignPlayer(',
  );
  assert.match(changes, /SyncStationheadBackgroundPreview\(\*player_, workspaceBounds_\)/);
});

test('non-auth playback selection changes only foreground state, not onscreen geometry', () => {
  const policy = section(
    layout,
    'constexpr StationheadSurfacePolicy ResolveStationheadSurfacePolicy(',
    'static_assert(!ResolveStationheadSurfacePolicy(',
  );
  assert.match(policy, /selectedTab == StationheadTabKind::Stationhead && loginRequired/);
  assert.match(
    layout,
    /!ResolveStationheadSurfacePolicy\(StationheadTabKind::Stationhead, true, false\)\.showPlayback/,
  );
  assert.match(
    layout,
    /ResolveStationheadSurfacePolicy\(StationheadTabKind::Stationhead, true, true\)\.showPlayback/,
  );

  const interactive = section(
    handles,
    'bool StationheadHandleBase::IsInteractive(',
    'bool StationheadHandleBase::SuppressTrackTransitionGap(',
  );
  assert.match(interactive, /status\.loginRequired \|\| status\.spotifyAuthorization/);
  assert.doesNotMatch(interactive, /!status\.audioPlaying/);
});

test('authentication overlays the media panel while playback remains onscreen underneath', () => {
  const apply = section(
    layout,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(apply, /const RECT surfaceBounds = StationheadBackgroundBounds\(workspaceBounds\)/);
  assert.match(apply, /const RECT monitorPanelBounds = StationheadMonitorPanelBounds\(workspaceBounds\)/);
  assert.match(apply, /playbackHostBounds = surfaceBounds/);
  assert.match(apply, /authHostBounds = showAuth \? monitorPanelBounds : surfaceBounds/);
  assert.match(apply, /hostPlacement = playbackForeground \? HWND_TOP : HWND_BOTTOM/);
  assert.match(apply, /authPlacement = showAuth \? HWND_TOP : HWND_BOTTOM/);
  assert.doesNotMatch(apply, /StationheadOffscreenBounds|authOffscreen/);
});
