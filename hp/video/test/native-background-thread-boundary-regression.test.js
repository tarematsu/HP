import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readNative = relative => readFileSync(
  new URL(`../../native/src/${relative}`, import.meta.url),
  'utf8',
);

const playback = readNative('dashboard_native_playback.cpp');
const radar = readNative('renderer_radar_ui.cpp');
const cloud = readNative('cloud_client.cpp');
const cloudHeader = readNative('cloud_client.h');

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('native playback thread cannot terminate the process on an escaped exception', () => {
  const start = section(
    playback,
    'void Renderer::StartNativePlaybackBridge()',
    'void Renderer::StopNativePlaybackBridge()',
  );
  assert.match(start, /nativePlaybackThread_\s*=\s*std::thread\(\[this\]/);
  assert.match(start, /for \(;;\)/);
  assert.match(start, /try \{\s*NativePlaybackLoop\(\);\s*return;/);
  assert.match(start, /catch \(\.\.\.\)/);
  assert.match(start, /nativePlaybackStopping_\.load\(std::memory_order_acquire\)/);
  assert.match(start, /Sleep\(1'000\)/);
});

test('native playback retry always balances its COM apartment', () => {
  const apartment = section(
    playback,
    'struct ScopedPlaybackComApartment',
    'void AppendSignatureBytes(',
  );
  assert.match(apartment, /CoInitializeEx\(nullptr, COINIT_MULTITHREADED\)/);
  assert.match(apartment, /if \(SUCCEEDED\(result\)\) CoUninitialize\(\)/);
  const loop = section(
    playback,
    'void Renderer::NativePlaybackLoop()',
    '}  // namespace hp',
  );
  assert.match(loop, /ScopedPlaybackComApartment apartment/);
  assert.doesNotMatch(loop, /const HRESULT apartment/);
});

test('radar compose thread cannot terminate the process on an escaped exception', () => {
  const start = section(
    radar,
    'void Renderer::StartRadarCompose()',
    'void Renderer::StopRadarCompose()',
  );
  assert.match(start, /radarComposeThread_\s*=\s*std::thread\(\[this\]/);
  assert.match(start, /for \(;;\)/);
  assert.match(start, /try \{\s*RadarComposeLoop\(\);\s*return;/);
  assert.match(start, /catch \(\.\.\.\)/);
  assert.match(start, /radarComposeStopping_\.load\(std::memory_order_acquire\)/);
  assert.match(start, /Sleep\(1'000\)/);
});

test('radar compose retry always balances its COM apartment', () => {
  const apartment = section(
    radar,
    'struct ScopedRadarComApartment',
    'struct RadarCompositionSurface',
  );
  assert.match(apartment, /CoInitializeEx\(nullptr, COINIT_MULTITHREADED\)/);
  assert.match(apartment, /if \(SUCCEEDED\(result\)\) CoUninitialize\(\)/);
  const loop = section(radar, 'void Renderer::RadarComposeLoop()', 'void Renderer::ComposeRadarFrame()');
  assert.match(loop, /ScopedRadarComApartment apartment/);
  assert.doesNotMatch(loop, /const HRESULT apartment/);
});

test('Cloud startup rolls back a partially created thread set', () => {
  assert.match(cloudHeader, /std::atomic<bool> started_\{false\}/);
  const start = section(cloud, 'void CloudClient::Start()', 'void CloudClient::Stop()');
  assert.match(start, /started_\.exchange\(true, std::memory_order_acq_rel\)/);
  assert.match(start, /thread_\s*=\s*std::thread\(\[this\]/);
  assert.match(start, /StartNetworkChangeWatcher\(\)/);
  assert.match(start, /catch \(\.\.\.\)/);
  assert.match(
    start,
    /catch \(\.\.\.\) \{[\s\S]*stopping_ = true;[\s\S]*StopNetworkChangeWatcher\(\);[\s\S]*if \(thread_\.joinable\(\)\) thread_\.join\(\);[\s\S]*started_ = false;[\s\S]*throw;/,
  );
});

test('Cloud worker entry catches exceptions outside the synchronization body', () => {
  const start = section(cloud, 'void CloudClient::Start()', 'void CloudClient::Stop()');
  assert.match(start, /for \(;;\)/);
  assert.match(start, /try \{\s*Loop\(\);\s*return;/);
  assert.match(start, /catch \(const std::exception& error\)/);
  assert.match(start, /catch \(\.\.\.\)/);
  assert.match(start, /stopping_\.load\(std::memory_order_acquire\)/);
  assert.match(start, /Sleep\(1'000\)/);
});

test('Cloud network watcher cannot leak an exception through std::thread', () => {
  const watcher = section(
    cloud,
    'void CloudClient::StartNetworkChangeWatcher()',
    'void CloudClient::StopNetworkChangeWatcher()',
  );
  assert.match(watcher, /networkChangeStopEvent_ \|\| networkChangeThread_\.joinable\(\)/);
  assert.match(watcher, /networkChangeThread_\s*=\s*std::thread\(\[this\]/);
  assert.match(watcher, /try \{/);
  assert.match(watcher, /catch \(\.\.\.\)/);
});

test('radar composition owns its bitmap and memory DC until publication', () => {
  const surface = section(
    radar,
    'struct RadarCompositionSurface',
    'HDC RadarSourceDc(',
  );
  assert.match(surface, /~RadarCompositionSurface\(\) \{\s*Reset\(\);/);
  assert.match(surface, /previous\s*&&\s*previous\s*!=\s*HGDI_ERROR/);
  assert.match(surface, /void FinishDrawing\(\) noexcept/);
  assert.match(surface, /DeleteDC\(dc\)/);
  assert.match(surface, /DeleteObject\(bitmap\)/);
  assert.match(surface, /HBITMAP Release\(\) noexcept/);

  const compose = section(
    radar,
    'void Renderer::ComposeRadarFrame()',
    '}  // namespace hp',
  );
  assert.match(compose, /RadarCompositionSurface surface/);
  assert.match(compose, /if \(!surface\.Initialize\(info, &pixels\)\) return/);
  assert.match(compose, /surface\.FinishDrawing\(\)/);
  assert.match(compose, /SaveBitmapAsBmp\(surface\.bitmap/);
  assert.match(compose, /HBITMAP composed = surface\.Release\(\)/);
  assert.ok(
    compose.indexOf('surface.FinishDrawing()') < compose.indexOf('SaveBitmapAsBmp(surface.bitmap'),
    'bitmap must be deselected before GetDIBits-based persistence',
  );
});

test('radar bitmap blending rejects failed GDI selections', () => {
  const blend = section(radar, 'void BlendBitmap(', '}  // namespace');
  assert.match(blend, /HGDIOBJ previous = SelectObject\(sourceDc, bitmap\)/);
  assert.match(blend, /if \(!previous \|\| previous == HGDI_ERROR\) return/);
  assert.ok(
    blend.indexOf('if (!previous || previous == HGDI_ERROR) return') <
      blend.indexOf('AlphaBlend('),
    'AlphaBlend must not run after SelectObject failure',
  );
});
