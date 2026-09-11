import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const renderer = readFileSync(
  new URL('../../native/src/renderer_radar_ui.cpp', import.meta.url),
  'utf8',
);
const radarCache = readFileSync(
  new URL('../../native/src/cloud_client_radar_cache.cpp', import.meta.url),
  'utf8',
);

test('radar JSON fast path points at the same localized representative PNG cache', () => {
  assert.match(radarCache, /const fs::path cacheRoot = dataDir_ \/ L"radar-cache"/);
  assert.match(
    renderer,
    /dataDir \/ L"radar-cache" \/ L"v1" \/ L"radar" \/ L"frame" \/\s*L"representative" \/ L"latest\.png"/s,
  );
  assert.match(renderer, /const std::string stamp = file::Stamp\(\*framePath\)/);
});
