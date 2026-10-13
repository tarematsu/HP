import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL('../../native/src/' + name, import.meta.url), 'utf8');
const radar = source('cloud_client_radar_cache.cpp');
const cloud = source('cloud_client.h');
const sync = source('cloud_client_sync.cpp');

test('cloud sync caches a validated representative PNG across unchanged polls', () => {
  assert.match(cloud, /struct RadarRepresentativeValidatedStamp/);
  assert.match(cloud, /radarRepresentativeValidatedStamp_;/);
  const start = sync.indexOf('  const auto requestedRadarVersion = [&]() {');
  const end = sync.indexOf('  std::wstring path = ', start);
  assert.ok(start >= 0 && end > start);
  const validation = sync.slice(start, end);
  assert.match(validation, /fs::exists\(radarPath, error\)/);
  assert.match(validation, /fs::file_size\(representativeRadarPath, error\)/);
  assert.match(validation, /fs::last_write_time\(representativeRadarPath, error\)/);
  const fast = validation.indexOf('radarRepresentativeValidatedStamp_.valid &&');
  const verify = validation.indexOf('if (!HasPngSignature(representativeRadarPath))');
  assert.ok(fast >= 0 && verify > fast,
    'unchanged valid PNGs must bypass filesystem header reads');
  assert.match(validation, /radarRepresentativeValidatedStamp_ = \{size, modifiedAt, true\}/);
  assert.ok((validation.match(/radarRepresentativeValidatedStamp_\.valid = false/g) || []).length >= 3,
    'missing radar JSON, missing PNG or invalid signature must invalidate the cached proof');
  const valid = (cache, png) => png.present && png.size >= 8 &&
    cache.valid && cache.size === png.size && cache.stamp === png.stamp;
  const cache = { valid: true, size: 240, stamp: 77 };
  assert.equal(valid(cache, { present: true, size: 240, stamp: 77 }), true);
  assert.equal(valid(cache, { present: true, size: 240, stamp: 78 }), false);
  assert.equal(valid(cache, { present: true, size: 0, stamp: 77 }), false);
  assert.equal(valid(cache, { present: false, size: 240, stamp: 77 }), false);
});

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
  assert.match(radar.slice(tile, directoryTraversal), /const auto cachedSize = fs::file_size\(target, error\);\s*if \(error \|\| cachedSize == 0\)/);
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


test('radar bundle and standalone tiles reuse one filesystem size query, including missing/empty fallback', () => {
  const bundleStart = radar.indexOf('      for (uint32_t record = 0; record < recordCount; ++record) {');
  const bundleEnd = radar.indexOf('      if (offset != response.body.size())', bundleStart);
  const standaloneStart = radar.indexOf('  const auto localizeTile =');
  const standaloneEnd = radar.indexOf('  if (root.HasKey(L"frames")', standaloneStart);
  assert.ok(bundleStart >= 0 && bundleEnd > bundleStart &&
    standaloneStart > bundleEnd && standaloneEnd > standaloneStart);
  for (const section of [
    radar.slice(bundleStart, bundleEnd),
    radar.slice(standaloneStart, standaloneEnd),
  ]) {
    assert.equal((section.match(/fs::file_size\(target, error\)/g) || []).length, 1);
    assert.match(section, /const auto cachedSize = fs::file_size\(target, error\)/);
    assert.match(section, /if \(error \|\| cachedSize == 0\)/);
    assert.doesNotMatch(section, /fs::exists\(target, error\)/);
    assert.match(section, /AtomicWriteBytes\(target, response\.body/);
  }
  // A missing tile reports an error from file_size. Existing zero-byte tiles
  // must be repaired; positive-size cached tiles must avoid further fetches.
  const shouldRefetch = (error, size) => error || size === 0;
  assert.equal(shouldRefetch(true, 0), true);
  assert.equal(shouldRefetch(false, 0), true);
  assert.equal(shouldRefetch(false, 28412), false);
});
