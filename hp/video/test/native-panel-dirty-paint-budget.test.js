import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = file => readFileSync(
  new URL('../../native/src/' + file, import.meta.url), 'utf8');
const app = source('app.cpp');
const lifecycle = source('renderer_lifecycle.cpp');
const renderer = source('web_renderer.h');
const panels = source('renderer_panels/windows.inc');
const backBuffer = source('renderer_bitmap_cache.cpp');

function section(code, start, end) {
  const at = code.indexOf(start);
  const until = code.indexOf(end, at + start.length);
  assert.ok(at >= 0 && until > at, 'missing section: ' + start);
  return code.slice(at, until);
}

test('top-level WM_PAINT uses BeginPaint HDC and dirty RECT without reentering GetDC', () => {
  const draw = section(app, 'void App::Draw() {', 'void App::ShowToast(');
  assert.match(draw, /HDC dc = BeginPaint\(window_, &paint\);/);
  assert.match(draw, /renderer_->Render\(dc, paint\.rcPaint\);/);
  assert.match(draw, /if \(dc\) EndPaint\(window_, &paint\);/);
  assert.doesNotMatch(draw, /renderer_->Render\(\)|GetDC\(|ReleaseDC\(/);

  const clipped = section(lifecycle,
    'void Renderer::Render(HDC dc, const RECT& dirty) {',
    'void Renderer::Render() {');
  assert.match(clipped, /IsRectEmpty\(&dirty\)/);
  assert.match(clipped, /FillRect\(dc, &dirty, DashboardBackgroundBrush\(\)\)/);
  assert.doesNotMatch(clipped, /GetDC|ReleaseDC|GetClientRect/);
  assert.match(renderer, /void Render\(HDC dc, const RECT& dirty\);/);
});

test('startup still primes the full parent background before showing its HWND', () => {
  const startup = section(app, 'void App::StartServices()', 'void App::StartDeferredServices(');
  assert.match(startup, /renderer_->Render\(\);/);
  const initialize = startup.indexOf('renderer_->Render();');
  const redraw = startup.indexOf('RedrawWindow(window_', initialize);
  const show = startup.indexOf('ShowWindow(window_, startupShowCommand_)', redraw);
  assert.ok(initialize >= 0 && redraw > initialize && show > redraw);

  const full = section(lifecycle, 'void Renderer::Render() {', '}  // namespace hp');
  assert.match(full, /if \(GetClientRect\(window_, &bounds\)\) Render\(dc, bounds\);/);
  assert.match(full, /ReleaseDC\(window_, dc\)/);
});

test('media-only child paints its dirty area black without shared GDI bitmap or BitBlt', () => {
  const mediaPaint = panels.slice(panels.indexOf('void Renderer::PaintNativeMedia(HWND hwnd) {'));
  assert.match(mediaPaint, /HDC dc = BeginPaint\(hwnd, &paint\);/);
  assert.match(mediaPaint, /FillRect\(dc, &paint\.rcPaint,/);
  assert.match(mediaPaint, /GetStockObject\(BLACK_BRUSH\)/);
  assert.match(mediaPaint, /EndPaint\(hwnd, &paint\)/);
  assert.doesNotMatch(mediaPaint, /NativePanelPaintScope|NativePanelBackBuffer|BitBlt|StretchRadarInto|radarFrameBitmap_/);
  assert.match(backBuffer, /HBITMAP Renderer::NativePanelBackBuffer/);
});

test('actual dashboard and radar panels retain buffered painting', () => {
  const side = section(panels,
    'void Renderer::PaintNativeSide(HWND hwnd) {',
    'void Renderer::PaintNativeMain(HWND hwnd) {');
  const main = section(panels,
    'void Renderer::PaintNativeMain(HWND hwnd) {',
    'void Renderer::PaintNativeMedia(HWND hwnd) {');
  assert.match(side, /NativePanelPaintScope scope\(\*this, hwnd\)/);
  assert.match(main, /NativePanelPaintScope scope\(\*this, hwnd\)/);
  assert.match(main, /DrawRadarSection\(scope\.dc, sections\.energy\)/);
});
