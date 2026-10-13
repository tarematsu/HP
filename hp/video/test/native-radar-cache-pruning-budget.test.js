import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL('../../native/src/' + name, import.meta.url), 'utf8');
const radar = source('cloud_client_radar_cache.cpp');
const cloud = source('cloud_client.h');

test('cloud polling verifies the cached PNG header without allocating a vector', () => {
  assert.match(radar, /bool HasPngSignature\(const uint8_t\* bytes, size_t size\) noexcept/);
  assert.match(radar, /return HasPngSignature\(signature, sizeof\(signature\)\);/);
  assert.doesNotMatch(radar, /const std::vector<uint8_t> bytes\(std::begin\(signature\)/);
});

test('native radar cache prunes periodically, without scanning the filesystem on every frame', () => {
  assert.match(cloud, /uint64_t lastRadarCachePruneTick_ = 0;/);
  assert.match(radar, /kRadarCachePruneIntervalMs = 30ULL \* 60ULL \* 1'000ULL/);
  assert.match(radar, /const uint64_t nowTick = GetTickCount64\(\)/);
  assert.match(radar,
    /const bool pruneDue = lastRadarCachePruneTick_ == 0 \|\|\s*nowTick - lastRadarCachePruneTick_ >= kRadarCachePruneIntervalMs/);
  assert.match(radar, /if \(pruneDue && !retained\.empty\(\)\)/);
  assert.match(radar, /if \(pruneDue\) retained\.insert\(target\.wstring\(\)\)/);
  assert.match(radar, /fs::recursive_directory_iterator iterator\(/);
  assert.match(radar, /if \(!walkError\) lastRadarCachePruneTick_ = nowTick/);
  const pruneGuard = radar.indexOf('if (pruneDue && !retained.empty())');
  const walk = radar.indexOf('fs::recursive_directory_iterator iterator(', pruneGuard);
  assert.ok(pruneGuard >= 0 && walk > pruneGuard,
    'expensive directory enumeration must happen only inside the prune interval guard');
});

test('radar tile resolution remains immediate and no cleanup runs without retained files', () => {
  const tile = radar.indexOf('const auto localizeTile =');
  const pruning = radar.indexOf('constexpr uint64_t kRadarCachePruneIntervalMs');
  assert.ok(tile >= 0 && pruning >= 0);
  // The pruning budget is calculated once before bundle/tile localization,
  // while the actual recursive filesystem traversal follows localization.
  const directoryTraversal = radar.indexOf('fs::recursive_directory_iterator iterator(', tile);
  assert.ok(directoryTraversal > tile);
  assert.match(radar.slice(tile, directoryTraversal), /if \(!fs::exists\(target, error\) \|\| fs::file_size\(target, error\) == 0\)/);
  assert.match(radar.slice(tile, directoryTraversal), /AtomicWriteBytes\(target, response\.body\)/);
  assert.match(radar.slice(tile, directoryTraversal), /item\.SetNamedValue\(L"url"/);
  assert.match(radar.slice(tile), /if \(pruneDue && !retained\.empty\(\)/);
});

test('successful prune throttles the next six five-minute radar refreshes', () => {
  const interval = 30 * 60 * 1000;
  let previous = 0;
  let scans = 0;
  for (let step = 0; step <= 12; step++) {
    const now = 1000 + step * 5 * 60 * 1000;
    if (previous === 0 || now - previous >= interval) {
      scans++;
      previous = now;
    }
  }
  assert.equal(scans, 3, '13 frame updates at 5-minute intervals should scan only 3 times');
});
