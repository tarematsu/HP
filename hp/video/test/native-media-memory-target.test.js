import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const nativeRoot = fileURLToPath(new URL('../../native/src/', import.meta.url));

function nativeSources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return nativeSources(path);
    if (!/\.(?:h|hpp|cpp|cc|cxx|inc)$/i.test(entry.name)) return [];
    return [readFileSync(path, 'utf8')];
  });
}

const nativeSource = nativeSources(nativeRoot).join('\n');

test('native media never overrides the WebView2 memory usage target', () => {
  assert.doesNotMatch(nativeSource, /MemoryUsageTargetLevel/);
  assert.doesNotMatch(nativeSource, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_/);
});
