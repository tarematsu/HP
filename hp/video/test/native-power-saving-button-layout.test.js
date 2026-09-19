import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controller = readFileSync(
  new URL('../../native/src/power_saving_controller.cpp', import.meta.url),
  'utf8',
);
const brightness = readFileSync(
  new URL('../../native/src/power_saving_brightness.inc', import.meta.url),
  'utf8',
);
const routing = readFileSync(
  new URL('../../native/src/power_saving_window_routing.inc', import.meta.url),
  'utf8',
);
const schedule = readFileSync(
  new URL('../../native/src/power_saving_schedule.inc', import.meta.url),
  'utf8',
);
const overlay = readFileSync(
  new URL('../../native/src/power_saving_overlay.inc', import.meta.url),
  'utf8',
);
const spotifyLayout = readFileSync(
  new URL('../../native/src/spotify_host_layout.inc', import.meta.url),
  'utf8',
);
const spotifyFoundation = readFileSync(
  new URL('../../native/src/spotify_webview_foundation.inc', import.meta.url),
  'utf8',
);
const grid = readFileSync(
  new URL('../../native/src/service_monitor_grid.h', import.meta.url),
  'utf8',
);
const source = [controller, brightness, routing, schedule, overlay].join('\n');
const header = readFileSync(
  new URL('../../native/src/power_saving_controller.h', import.meta.url),
  'utf8',
);
const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);
const mediaHost = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url),
  'utf8',
);
const layout = readFileSync(
  new URL('../../native/src/renderer_panels/layout_overrides.inc', import.meta.url),
  'utf8',
);
const app = readFileSync(
  new URL('../../native/src/app.cpp', import.meta.url),
  'utf8',
);

test('power-saving controller composes focused responsibilities without a thread-wide hook', () => {
  assert.match(controller, /#include "power_saving_brightness\.inc"/);
  assert.match(controller, /#include "power_saving_window_routing\.inc"/);
  assert.match(controller, /#include "power_saving_schedule\.inc"/);
  assert.match(controller, /#include "power_saving_overlay\.inc"/);
  assert.match(routing, /::SetWindowSubclass/);
  assert.match(routing, /::RemoveWindowSubclass/);
  assert.doesNotMatch(source, /SetWindowsHookExW|WH_CALLWNDPROC|CallWndProc/);
  assert.match(brightness, /ApplyMinimumBrightness\(\)/);
  assert.match(schedule, /NextScheduleBoundary\(int64_t nowMs\)/);
  assert.match(overlay, /void PowerSavingController::PaintOverlay/);
});

test('update, monitor and audio output controls share one horizontal clock footer row', () => {
  assert.match(overlay, /constexpr size_t kControlButtonCount = 3/);
  assert.match(overlay, /const int upperMediaHeight = sideHeight \* 480 \/ 1000/);
  assert.match(overlay, /compactAvailable \* 55 \/ 100/);
  assert.match(overlay, /contentHeight \* 790 \/ 1000/);
  assert.match(overlay, /contentWidth \* 205 \/ 1000, 74, 110/);
  assert.match(overlay, /ControlButtonGap\(contentWidth\)/);
  assert.match(overlay, /ControlButtonRect\(row, 0\)/);
  assert.match(overlay, /ControlButtonRect\(row, 1\)/);
  assert.match(overlay, /ControlButtonRect\(row, 2\)/);
  assert.match(overlay, /button\.bottom - button\.top\) \* 42 \/ 100/);
  assert.match(overlay, /L"更新"/);
  assert.match(overlay, /L"モニターYT"/);
  assert.match(overlay, /L"モニターS"/);
  assert.match(overlay, /L"モニターOFF"/);
  assert.doesNotMatch(overlay, /L"モニターST"|L"モニターS[1-5]"/);
  assert.match(overlay, /L"音声出力YT"/);
  assert.match(overlay, /L"音声出力ST"/);
  assert.match(overlay, /L"音声出力S1"/);
  assert.match(overlay, /L"音声出力S2"/);
  assert.match(overlay, /L"音声出力S3"/);
  assert.match(overlay, /L"音声出力S4"/);
  assert.match(overlay, /L"音声出力S5"/);
  assert.match(overlay, /L"音声出力OFF"/);
  assert.doesNotMatch(overlay, /L"ミュート(?:A|B|C|D|E|F|AB)"/);
  assert.match(header, /enum class MonitorMode[\s\S]*Native,[\s\S]*ServiceGrid,[\s\S]*Off/);
  assert.match(header, /MonitorMode monitorMode_ = MonitorMode::Native/);
  assert.match(header, /enum class AudioMode/);
  assert.match(header, /AudioMode audioMode_ = AudioMode::Media/);
  assert.match(header, /RECT LocalUpdateButtonRect\(\) const/);
  assert.match(layout, /SpanY\(hpClockContent, 780\)/);
  assert.match(layout, /SpanY\(hpClockContent, 790\)/);
  assert.match(layout, /hpControlButtonWidth = std::clamp\(SpanX\(hpStatusRect, 205\), 74, 110\)/);
  assert.match(layout, /hpControlRowWidth = hpControlButtonWidth \* 3 \+ hpControlButtonGap \* 2/);
});

test('monitor button cycles YT, unified S grid, black OFF, then YT', () => {
  assert.match(overlay, /controller->CycleMonitorMode\(\)/);
  assert.match(
    schedule,
    /case MonitorMode::Native:[\s\S]*ApplyMonitorMode\(MonitorMode::ServiceGrid\)[\s\S]*case MonitorMode::ServiceGrid:[\s\S]*ApplyMonitorMode\(MonitorMode::Off\)[\s\S]*case MonitorMode::Off:[\s\S]*ApplyMonitorMode\(MonitorMode::Native\)/,
  );
  assert.match(schedule, /SetSpotifyMonitorForegroundSlot\(-1\)/);
  assert.match(schedule, /SetSpotifyMonitorGridVisible\(mode == MonitorMode::ServiceGrid\)/);
  assert.match(spotifyFoundation, /bool gSpotifyMonitorGridVisible = false/);
  assert.match(spotifyFoundation, /SetSpotifyMonitorGridVisible\(bool visible\)/);
  assert.match(grid, /kServiceMonitorTileCount = 6/);
  assert.match(grid, /kServiceMonitorColumns = 3/);
  assert.match(grid, /kServiceMonitorRows = 2/);
  assert.doesNotMatch(grid, /ComputeNativeDashboardLayout/);
  assert.match(grid, /workspaceBounds\.right - workspaceBounds\.left/);
  assert.match(grid, /workspaceBounds\.bottom - workspaceBounds\.top/);
  assert.match(spotifyLayout, /ServiceMonitorTileBounds\(client, i \+ 1\)/);
  assert.match(spotifyLayout, /gSpotifyMonitorGridVisible && !loginPage/);
  assert.match(routing, /ServiceMonitorTileBounds\(parentClient, 0\)/);
  assert.match(routing, /monitorMode_ == MonitorMode::ServiceGrid/);
  assert.match(schedule, /powerSaving_ = nextPowerSaving/);
  assert.match(
    schedule,
    /Renderer::SetGlobalPowerSavingMode\(\s*powerSaving_ \|\| mode == MonitorMode::ServiceGrid\s*\)/,
  );
  assert.match(schedule, /ApplyStationheadMonitorPlacement\(\)/);
  assert.match(routing, /monitorMode_ = MonitorMode::Native/);
  assert.match(routing, /SetSpotifyMonitorGridVisible\(false\)/);
});

test('update button routes through the existing verified app-update action', () => {
  assert.match(
    overlay,
    /PostMessageW\([\s\S]*kRendererActionMessage,[\s\S]*static_cast<WPARAM>\(UiAction::AppUpdate\)/,
  );
  assert.match(app, /case UiAction::AppUpdate:[\s\S]*CheckForUpdateAsync\(true\)/);
});

test('compact overlay clips the complete three-button control row', () => {
  assert.match(overlay, /const bool compact = !powerSaving_ \|\| mvStartupInputPass_/);
  assert.match(overlay, /if \(compact\) target = ParentControlStackRect\(\)/);
  assert.match(overlay, /CreateRoundRectRgn\(/);
  assert.match(overlay, /SetWindowRgn\(overlay_, region, TRUE\)/);
  assert.match(overlay, /SetWindowRgn\(overlay_, nullptr, TRUE\)/);
});

test('audio output cycles YT, ST, fixed Spotify S1/S2/S3/S4/S5, then OFF', () => {
  assert.match(overlay, /controller->CycleAudioMode\(\)/);
  assert.match(
    schedule,
    /case AudioMode::Media:[\s\S]*ApplyAudioMode\(AudioMode::Stationhead\)[\s\S]*case AudioMode::Stationhead:[\s\S]*ApplyAudioMode\(AudioMode::SpotifyPrimary\)[\s\S]*case AudioMode::SpotifyPrimary:[\s\S]*ApplyAudioMode\(AudioMode::SpotifySecondary\)[\s\S]*case AudioMode::SpotifySecondary:[\s\S]*ApplyAudioMode\(AudioMode::SpotifyTertiary\)[\s\S]*case AudioMode::SpotifyTertiary:[\s\S]*ApplyAudioMode\(AudioMode::SpotifyQuaternary\)[\s\S]*case AudioMode::SpotifyQuaternary:[\s\S]*ApplyAudioMode\(AudioMode::SpotifyQuinary\)[\s\S]*case AudioMode::SpotifyQuinary:[\s\S]*ApplyAudioMode\(AudioMode::Muted\)[\s\S]*case AudioMode::Muted:[\s\S]*ApplyAudioMode\(AudioMode::Media\)/,
  );
  assert.match(schedule, /mediaMuted_ = mode != AudioMode::Media/);
  assert.match(schedule, /SetNativeMediaPanelMuted\(mediaMuted_\)/);
  assert.match(schedule, /mode == AudioMode::SpotifyPrimary \? 0/);
  assert.match(schedule, /mode == AudioMode::SpotifySecondary \? 1/);
  assert.match(schedule, /mode == AudioMode::SpotifyTertiary \? 2/);
  assert.match(schedule, /mode == AudioMode::SpotifyQuaternary \? 3/);
  assert.match(schedule, /mode == AudioMode::SpotifyQuinary \? 4 : -1/);
  assert.match(schedule, /SetSpotifyAudioOutputSlot\(spotifyAudioAccount\)/);
  assert.match(spotifyFoundation, /int gSpotifyAudioOutputAccountIndex = -1/);
  assert.match(spotifyFoundation, /int gSpotifyAudioOutputSlot = -1/);
  assert.match(spotifyFoundation, /SpotifyRuntimeLaneForControlAccount\(gSpotifyAudioOutputAccountIndex\)/);
  assert.match(spotifyFoundation, /runtimeLane != gSpotifyAudioOutputSlot/);
  assert.match(
    schedule,
    /mode == AudioMode::Stationhead[\s\S]*UiAction::StationheadAudioToggle[\s\S]*UiAction::StationheadAudioMute/,
  );
  assert.match(
    routing,
    /audioMode_ = AudioMode::Media;[\s\S]*ApplyAudioMode\(audioMode_\)/,
  );
  assert.match(
    app,
    /case UiAction::StationheadAudioToggle:[\s\S]*stationhead_->SetAudioMuted\(stationheadAudioMuted_\)/,
  );
  assert.match(
    app,
    /case UiAction::StationheadAudioMute:[\s\S]*stationhead_->SetAudioMuted\(true\)/,
  );
});

test('media mute changes only YouTube/TVer WebView audio state and keeps playback alive', () => {
  assert.match(mediaHost, /void SetMuted\(bool muted\) noexcept/);
  assert.match(mediaHost, /ComPtr<ICoreWebView2_8> audio/);
  assert.match(mediaHost, /audio->put_IsMuted\(muted \? TRUE : FALSE\)/);
  assert.match(mediaHost, /SetMuted\(muted_\)/);
  assert.match(composition, /if \(host\) host->SetMuted\(muted\)/);
  assert.doesNotMatch(composition, /SuspendNativeMediaPanelWebView/);
  assert.doesNotMatch(composition, /ResumeNativeMediaPanelWebView/);
  assert.doesNotMatch(composition, /CreateNativeMediaPlaceholderHost/);
  assert.doesNotMatch(composition, /DestroyWindow\(hostWindow\)/);
  assert.doesNotMatch(composition, /SetSpotifyMediaNetworkBlocked\(muted\)/);
});

test('MV startup input pass keeps all overlay controls in local coordinates', () => {
  assert.match(
    overlay,
    /if \(powerSaving_ && !mvStartupInputPass_\) \{[\s\S]*row = ParentControlStackRect\(\);[\s\S]*\} else \{[\s\S]*GetClientRect\(overlay_, &row\)/,
  );
});