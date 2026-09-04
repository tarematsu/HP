import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../../native/src/power_saving_controller.cpp', import.meta.url),
  'utf8',
);
const header = readFileSync(
  new URL('../../native/src/power_saving_controller.h', import.meta.url),
  'utf8',
);
const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);
const layout = readFileSync(
  new URL('../../native/src/renderer_panels/layout_overrides.inc', import.meta.url),
  'utf8',
);

test('power saving and media mute controls share a compact two-row clock footer stack', () => {
  assert.match(source, /contentHeight \* 790 \/ 1000/);
  assert.match(source, /contentWidth \* 220 \/ 1000, 78, 112/);
  assert.match(source, /ParentControlStackRect\(\)/);
  assert.match(source, /ControlButtonRect\(stack, false\)/);
  assert.match(source, /ControlButtonRect\(stack, true\)/);
  assert.match(source, /L"省電力 ON" : L"省電力"/);
  assert.match(source, /L"ミュート ON" : L"ミュート"/);
  assert.match(header, /bool mediaMuted_ = false/);
  assert.match(layout, /SpanY\(hpClockContent, 780\)/);
  assert.match(layout, /SpanY\(hpClockContent, 790\)/);
  assert.match(layout, /hpControlButtonWidth/);
});

test('compact overlay clips the complete two-button control stack', () => {
  assert.match(source, /const bool compact = !powerSaving_ \|\| mvStartupInputPass_/);
  assert.match(source, /if \(compact\) target = ParentControlStackRect\(\)/);
  assert.match(source, /CreateRoundRectRgn\(0, 0, width \+ 1, height \+ 1/);
  assert.match(source, /SetWindowRgn\(overlay_, region, TRUE\)/);
  assert.match(source, /SetWindowRgn\(overlay_, nullptr, TRUE\)/);
});

test('mute button controls only the YouTube/TVer WebView through native WebView2 mute', () => {
  assert.match(source, /ApplyMediaMute\(!controller->mediaMuted_\)/);
  assert.match(source, /SetNativeMediaPanelMuted\(enabled\)/);
  assert.match(composition, /ComPtr<ICoreWebView2_8> gNativeMediaAudioWebView/);
  assert.match(composition, /put_IsMuted\(gNativeMediaMuted \? TRUE : FALSE\)/);
  assert.match(composition, /put_IsMuted\(muted \? TRUE : FALSE\)/);
  assert.match(composition, /RegisterNativeMediaAudioWebView\(webview_\.Get\(\)\)/);
  assert.match(
    composition,
    /#define get_CoreWebView2\(out\)[\s\S]*RegisterNativeMediaAudioWebView\(webview_\.Get\(\)\)[\s\S]*#include "renderer_panels\/media_section\.inc"/,
  );
});

test('MV startup input pass keeps both overlay controls in local coordinates', () => {
  assert.match(
    source,
    /if \(powerSaving_ && !mvStartupInputPass_\) \{[\s\S]*stack = ParentControlStackRect\(\);[\s\S]*\} else \{[\s\S]*GetClientRect\(overlay_, &stack\)/,
  );
});
