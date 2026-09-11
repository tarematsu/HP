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

test('power saving and media mute controls share one enlarged horizontal clock footer row', () => {
  assert.match(overlay, /const int upperMediaHeight = sideHeight \* 600 \/ 1000/);
  assert.match(overlay, /compactAvailable \* 55 \/ 100/);
  assert.match(overlay, /contentHeight \* 790 \/ 1000/);
  assert.match(overlay, /contentWidth \* 245 \/ 1000, 92, 132/);
  assert.match(overlay, /ControlButtonGap\(contentWidth\)/);
  assert.match(overlay, /ControlButtonRect\(row, false\)/);
  assert.match(overlay, /ControlButtonRect\(row, true\)/);
  assert.match(overlay, /button\.bottom - button\.top\) \* 42 \/ 100/);
  assert.match(overlay, /L"省電力 ON" : L"省電力"/);
  assert.match(overlay, /L"ミュート ON" : L"ミュート"/);
  assert.match(header, /bool mediaMuted_ = false/);
  assert.match(layout, /SpanY\(hpClockContent, 780\)/);
  assert.match(layout, /SpanY\(hpClockContent, 790\)/);
  assert.match(layout, /hpControlButtonWidth = std::clamp\(SpanX\(hpStatusRect, 245\), 92, 132\)/);
  assert.match(layout, /hpControlRowWidth = hpControlButtonWidth \* 2 \+ hpControlButtonGap/);
});

test('compact overlay clips the complete two-button control row', () => {
  assert.match(overlay, /const bool compact = !powerSaving_ \|\| mvStartupInputPass_/);
  assert.match(overlay, /if \(compact\) target = ParentControlStackRect\(\)/);
  assert.match(overlay, /CreateRoundRectRgn\(/);
  assert.match(overlay, /SetWindowRgn\(overlay_, region, TRUE\)/);
  assert.match(overlay, /SetWindowRgn\(overlay_, nullptr, TRUE\)/);
});

test('mute changes only WebView audio state and keeps playback alive', () => {
  assert.match(overlay, /ApplyMediaMute\(!controller->mediaMuted_\)/);
  assert.match(schedule, /SetNativeMediaPanelMuted\(enabled\)/);
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

test('MV startup input pass keeps both overlay controls in local coordinates', () => {
  assert.match(
    overlay,
    /if \(powerSaving_ && !mvStartupInputPass_\) \{[\s\S]*row = ParentControlStackRect\(\);[\s\S]*\} else \{[\s\S]*GetClientRect\(overlay_, &row\)/,
  );
});
