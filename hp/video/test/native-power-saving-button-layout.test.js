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
  for (const name of ['ozeki', 'tgut', 'yuukiar', 'ten', 'nagi', 'hinata']) {
    assert.match(overlay, new RegExp(`L"モニター${name}"`));
  }
  assert.match(overlay, /L"モニターOFF"/);
  assert.doesNotMatch(overlay, /L"モニターS(?:T|[1-5])"/);
  assert.match(overlay, /L"音声出力YT"/);
  for (const name of ['ozeki', 'tgut', 'yuukiar', 'ten', 'nagi', 'hinata']) {
    assert.match(overlay, new RegExp(`L"音声出力${name}"`));
  }
  assert.doesNotMatch(overlay, /L"音声出力S(?:T|[1-5])"/);
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

test('monitor button cycles YT, six named Stationhead windows, OFF, then YT', () => {
  assert.match(overlay, /controller->CycleMonitorMode\(\)/);
  assert.match(schedule, /monitorStationheadProfile_ = 6/);
  assert.match(schedule, /monitorStationheadProfile_ == 6[\s\S]*\? 1/);
  assert.match(schedule, /std::clamp\(monitorStationheadProfile_ \+ 1, 1u, 5u\)/);
  assert.match(schedule, /monitorStationheadProfile_ == 5[\s\S]*ApplyMonitorMode\(MonitorMode::Off\)/);
  assert.match(schedule, /case MonitorMode::Off:[\s\S]*ApplyMonitorMode\(MonitorMode::Native\)/);
  assert.match(routing, /StationheadProfileNumberFromWindow\(HWND window\)/);
  assert.match(routing, /StationheadProfileNumberFromWindow\(child\) != context->selectedProfile/);
  assert.match(routing, /const RECT monitorBounds = ComputeNativeDashboardLayout\(parentClient\)\.media;/);
  assert.match(routing, /const RECT target = context->monitorBounds;/);
  assert.match(routing, /const bool nativeMediaForeground = monitorMode_ != MonitorMode::Off;/);
  assert.match(routing, /SetStationheadMonitorProfile\(selectedProfile\)/);
  assert.match(schedule, /powerSaving_ = nextPowerSaving/);
  assert.match(schedule, /ApplyStationheadMonitorPlacement\(\)/);
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

test('named monitor and audio labels shrink to fit narrow control buttons', () => {
  assert.match(overlay, /GetTextExtentPoint32W/);
  assert.match(overlay, /availableTextWidth/);
  assert.match(overlay, /fontHeight = std::max\([\s\S]*9,/);
});

test('audio output cycles YT and six named Stationhead windows, then OFF', () => {
  assert.match(overlay, /controller->CycleAudioMode\(\)/);
  assert.match(
    schedule,
    /case AudioMode::Media:[\s\S]*ApplyAudioMode\(AudioMode::Stationhead\)[\s\S]*case AudioMode::Stationhead:[\s\S]*ApplyAudioMode\(AudioMode::StationheadPeer1\)[\s\S]*case AudioMode::StationheadPeer1:[\s\S]*ApplyAudioMode\(AudioMode::StationheadPeer2\)[\s\S]*case AudioMode::StationheadPeer2:[\s\S]*ApplyAudioMode\(AudioMode::StationheadPeer3\)[\s\S]*case AudioMode::StationheadPeer3:[\s\S]*ApplyAudioMode\(AudioMode::StationheadPeer4\)[\s\S]*case AudioMode::StationheadPeer4:[\s\S]*ApplyAudioMode\(AudioMode::StationheadPeer5\)[\s\S]*case AudioMode::StationheadPeer5:[\s\S]*ApplyAudioMode\(AudioMode::Muted\)[\s\S]*case AudioMode::Muted:[\s\S]*ApplyAudioMode\(AudioMode::Media\)/,
  );
  assert.match(schedule, /mediaMuted_ = mode != AudioMode::Media/);
  assert.match(schedule, /SetNativeMediaPanelMuted\(mediaMuted_\)/);
  assert.doesNotMatch(schedule, /SetSpotifyAudioOutputSlot|spotifyAudioAccount/);
  assert.match(schedule, /UiAction::StationheadPeer1Audio/);
  assert.match(schedule, /UiAction::StationheadPeer2Audio/);
  assert.match(schedule, /UiAction::StationheadPeer3Audio/);
  assert.match(schedule, /UiAction::StationheadPeer4Audio/);
  assert.match(schedule, /UiAction::StationheadPeer5Audio/);
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
    /case UiAction::StationheadAudioMute:[\s\S]*stationhead_->SetAudioMuted\(true\)[\s\S]*mutePeers\(-1\)/,
  );
  assert.match(
    app,
    /case UiAction::StationheadPeer1Audio:[\s\S]*case UiAction::StationheadPeer5Audio:[\s\S]*mutePeers\(selectedPeer\)/,
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
