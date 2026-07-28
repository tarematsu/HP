import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const lifecycle = readFileSync(
  new URL('../../native/src/renderer_lifecycle.cpp', import.meta.url),
  'utf8',
);
const bitmapCache = readFileSync(
  new URL('../../native/src/renderer_bitmap_cache.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

function assertOrdered(source, markers) {
  let previous = -1;
  for (const marker of markers) {
    const at = source.indexOf(marker);
    assert.ok(at >= 0, `missing marker: ${marker}`);
    assert.ok(at > previous, `out-of-order marker: ${marker}`);
    previous = at;
  }
}

test('hidden native dashboard stops radar work before releasing display memory', () => {
  const setVisible = section(
    lifecycle,
    'void Renderer::SetVisible(bool visible)',
    'void Renderer::QueueAction(',
  );

  assertOrdered(setVisible, [
    'if (!visibilityChanged) return;',
    'if (visible)',
    'StartRadarCompose();',
    'NotifyRadarUpdated();',
    'StopRadarCompose();',
    'std::lock_guard lock(radarFrameMutex_);',
    'DeleteObject(radarFrameBitmap_);',
    'radarSignature_.clear();',
    'radarFailedTiles_.clear();',
    'ResetNativeBitmapCaches();',
  ]);
  assert.match(setVisible, /radarFrameBitmap_ = nullptr/);
  assert.match(setVisible, /radarTimeText_ = L"--:--"/);
});

test('dashboard image and panel caches are discarded while hidden', () => {
  const reset = section(
    bitmapCache,
    'void Renderer::ResetNativeBitmapCaches() noexcept',
    '\n}\n\n}  // namespace hp',
  );

  assert.match(reset, /ReleaseNativePanelSurfaces\(\)/);
  assert.match(reset, /deleteBitmaps\(nativeImageBitmaps_\)/);
  assert.match(reset, /deleteBitmaps\(nativeRadarBitmaps_\)/);
  assert.match(reset, /nativeImageUseCounter_ = 0/);
  assert.match(reset, /nativeRadarBitmapUseCounter_ = 0/);
});

test('one-second dashboard timer permits operating-system wake coalescing', () => {
  const setVisible = section(
    lifecycle,
    'void Renderer::SetVisible(bool visible)',
    'void Renderer::QueueAction(',
  );

  assert.match(lifecycle, /kNativePanelTimerToleranceMs = 100/);
  assert.match(setVisible, /SetCoalescableTimer\(/);
  assert.match(setVisible, /kNativePanelTickMs[\s\S]*kNativePanelTimerToleranceMs/);
  assert.match(setVisible, /coalesced != 0 \|\|[\s\S]*SetTimer\(/);
});
