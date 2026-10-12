import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL('../../native/src/web_renderer.h', import.meta.url), 'utf8');
const cache = readFileSync(
  new URL('../../native/src/renderer_bitmap_cache.cpp', import.meta.url), 'utf8');

test('all native child panels reuse one directly owned GDI backbuffer', () => {
  assert.match(header, /PanelBackBuffer nativeBackBuffer_;/);
  assert.doesNotMatch(header, /std::map<HWND, PanelBackBuffer>|nativeBackBuffers_/);
  const allocation = cache.slice(
    cache.indexOf('HBITMAP Renderer::NativePanelBackBuffer('),
    cache.indexOf('void Renderer::ReleaseNativePanelBackBuffer('));
  assert.match(allocation, /PanelBackBuffer& buffer = nativeBackBuffer_;/);
  assert.match(allocation, /buffer\.width >= width && buffer\.height >= height/);
  assert.match(allocation, /CreateCompatibleBitmap\(dc, targetWidth, targetHeight\)/);
  assert.doesNotMatch(allocation, /\[nullptr\]|std::map|try_emplace/);
});

test('GDI buffer is deleted and dimensions reset on renderer teardown', () => {
  const release = cache.slice(
    cache.indexOf('void Renderer::ReleaseNativePanelSurfaces() noexcept'),
    cache.indexOf('void Renderer::ResetNativeBitmapCaches() noexcept'));
  assert.match(release, /if \(nativeBackBuffer_\.bitmap\) DeleteObject\(nativeBackBuffer_\.bitmap\)/);
  assert.match(release, /nativeBackBuffer_ = \{\};/);
  assert.match(cache, /ReleaseNativePanelSurfaces\(\);/);
});
