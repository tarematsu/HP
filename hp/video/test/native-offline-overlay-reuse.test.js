import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const renderer = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url), 'utf8');
const xRuntime = readFileSync(
  new URL('../../native/src/renderer_panels/media_x_following_like.inc', import.meta.url), 'utf8');

test('offline warning caches exact Yu Gothic UI fonts across WM_PAINT calls', () => {
  const helper = renderer.slice(
    renderer.indexOf('struct CachedOfflineOverlayFonts {'),
    renderer.indexOf('LRESULT CALLBACK NativeMediaOfflineOverlayWindowProc('));
  const paint = renderer.slice(
    renderer.indexOf('LRESULT CALLBACK NativeMediaOfflineOverlayWindowProc('),
    renderer.indexOf('bool EnsureNativeMediaOfflineOverlayClass()'));
  assert.match(helper, /std::array<HFONT, 25> fonts\{\}/);
  assert.match(helper, /HFONT& font = fonts\[static_cast<size_t>\(height - 28\)\]/);
  assert.match(helper, /if \(!font\) \{\s*font = CreateFontW\(/);
  assert.match(helper, /L"Yu Gothic UI"/);
  assert.match(helper, /~CachedOfflineOverlayFonts\(\)[\s\S]*DeleteObject\(font\)/);
  assert.match(paint, /const int fontHeight = std::clamp\(height \/ 9, 28, 52\)/);
  assert.match(paint, /static thread_local CachedOfflineOverlayFonts cachedFonts/);
  assert.match(paint, /HFONT font = cachedFonts\.ForHeight\(fontHeight\)/);
  assert.match(paint, /if \(previous\) SelectObject\(dc, previous\)/);
  assert.doesNotMatch(paint, /CreateFontW\(|DeleteObject\(font\)/);
});

test('offline warning overlay suppresses repeated unchanged hide/paint/reposition', () => {
  const overlay = renderer.slice(
    renderer.indexOf('void SetNativeMediaOfflineOverlay('),
    renderer.indexOf('ComPtr<ICoreWebView2NavigationCompletedEventHandler>'));
  assert.match(overlay, /if \(overlay && \(GetWindowLongPtrW\(overlay, GWL_STYLE\) & WS_VISIBLE\)\)\s*ShowWindow\(overlay, SW_HIDE\)/);
  assert.match(overlay, /GetWindowRect\(overlay, &overlayRect\)/);
  assert.match(overlay, /MapWindowPoints\(nullptr, hostWindow,/);
  assert.match(overlay, /overlayRect\.left == 0 && overlayRect\.top == 0/);
  assert.match(overlay, /overlayRect\.right == width && overlayRect\.bottom == height/);
  assert.match(overlay, /GetWindow\(overlay, GW_HWNDPREV\) == nullptr/);
  assert.match(overlay, /if \(alreadyPlaced\) return;/);
  const skip = overlay.indexOf('if (alreadyPlaced) return;');
  const redraw = overlay.indexOf('InvalidateRect(overlay, nullptr, TRUE)');
  assert.ok(skip >= 0 && redraw > skip);
  assert.match(overlay, /SetWindowPos\(\s*overlay, HWND_TOP/);
});

test('cancelled X acceleration restores previous scroll cadence and distances', () => {
  assert.match(xRuntime, /const scrollDelayMs = 450/);
  assert.match(xRuntime, /const idleScrollDelayMs = 600/);
  assert.match(xRuntime, /const maxScrollStepPx = 56/);
  assert.match(xRuntime, /const minScrollStepPx = 20/);
  assert.match(xRuntime, /Math\.ceil\(Math\.abs\(distance\) \* 0\.70\)/);
  assert.match(xRuntime, /const accountCooldownMs = 48 \* 60 \* 60 \* 1000/);
  assert.match(xRuntime, /const authorFiltered =/);
  assert.match(xRuntime, /const hidden = filtered \|\| authorFiltered/);
});
