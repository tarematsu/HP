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

test('stable Stationhead background is offscreen unless startup or periodic preview is armed', () => {
  assert.match(bridge, /gStationheadBackgroundPreview\{false\}/);
  assert.match(
    bridge,
    /if \(!StationheadBackgroundPreview\(\)\)[\s\S]*return StationheadOffscreenBounds\(workspaceBounds\)/,
  );
  assert.match(bridge, /left = workspaceBounds\.left/);
  assert.match(bridge, /kStationheadSurfaceWidth = 480/);
  assert.match(bridge, /kStationheadSurfaceHeight = 270/);
});

test('initial startup explicitly arms the in-client background preview', () => {
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

test('50-minute refresh re-arms preview and stable audio returns it offscreen', () => {
  const periodic = section(
    handles,
    'bool IsStationheadPeriodicRefresh(',
    'void SyncStationheadBackgroundPreview(',
  );
  assert.match(periodic, /status\.navigating && status\.detail == kStationheadPeriodicRefreshDetail/);

  const sync = section(
    handles,
    'void SyncStationheadBackgroundPreview(',
    'static_assert(',
  );
  assert.match(sync, /IsStationheadPeriodicRefresh\(status\)/);
  assert.match(sync, /SetStationheadBackgroundPreview\(true\)/);
  assert.match(sync, /player\.AudioPlaying\(\) && !status\.navigating/);
  assert.match(sync, /!status\.loginRequired && !status\.spotifyAuthorization/);
  assert.match(sync, /SetStationheadBackgroundPreview\(false\)/);

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

test('non-auth playback selection cannot move Stationhead onscreen', () => {
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

test('authentication remains a foreground surface while playback is parked offscreen', () => {
  const apply = section(
    layout,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(apply, /const RECT authOffscreen = StationheadOffscreenBounds\(workspaceBounds\)/);
  assert.match(apply, /const RECT offscreen = hidePlayback[\s\S]*authOffscreen/);
  assert.match(apply, /authHostBounds = showAuth \? workspaceBounds : authOffscreen/);
  assert.match(apply, /authPlacement = showAuth \? HWND_TOP : HWND_BOTTOM/);
});
