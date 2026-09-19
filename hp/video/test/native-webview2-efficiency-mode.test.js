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

test('native source contains no Windows efficiency-mode throttling', () => {
  assert.doesNotMatch(nativeSource, /ProcessPowerThrottling/);
  assert.doesNotMatch(nativeSource, /PROCESS_POWER_THROTTLING_EXECUTION_SPEED/);
  assert.doesNotMatch(nativeSource, /SetWebViewRendererEfficiencyMode/);
  assert.doesNotMatch(nativeSource, /SetWindowsProcessEfficiencyMode/);
  assert.doesNotMatch(nativeSource, /ApplyEfficiencyModeTo/);
  assert.doesNotMatch(nativeSource, /BELOW_NORMAL_PRIORITY_CLASS/);
  assert.doesNotMatch(nativeSource, /IDLE_PRIORITY_CLASS/);
});
