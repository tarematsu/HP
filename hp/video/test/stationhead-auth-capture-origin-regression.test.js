import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sharedSource = readFileSync(
  new URL('../../native/src/sh_shared.h', import.meta.url),
  'utf8',
);
const lifecycleSource = readFileSync(
  new URL('../../native/src/sh_runtime_lifecycle_policy_fix.h', import.meta.url),
  'utf8',
);

function occurrences(source, fragment) {
  let count = 0;
  for (let at = source.indexOf(fragment); at >= 0; at = source.indexOf(fragment, at + 1)) {
    count += 1;
  }
  return count;
}

test('auth capture origin fix replaces each base marker exactly once', () => {
  assert.equal(
    occurrences(
      sharedSource,
      "if (host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) return;",
    ),
    2,
  );
  assert.equal(
    occurrences(
      sharedSource,
      "const relevant = url => /(^|\\.)stationhead\\.com/i.test(String(url || ''));",
    ),
    1,
  );
  assert.equal(
    occurrences(
      sharedSource,
      "const url = typeof input === 'string' ? input : (input && input.url) || '';",
    ),
    1,
  );
  for (const marker of [
    'authDocumentGateReplaced',
    'authRelevantUrlReplaced',
    'authFetchUrlReplaced',
  ]) {
    assert.match(lifecycleSource, new RegExp(`const bool ${marker}`));
    assert.match(lifecycleSource, new RegExp(`\\(void\\)${marker};`));
  }
});

test('auth capture is top-level and accepts only HTTPS Stationhead hosts', () => {
  assert.match(
    lifecycleSource,
    /window\.top !== window\) return;/,
  );
  assert.match(
    lifecycleSource,
    /const NativeURL = window\.URL;/,
  );
  assert.match(
    lifecycleSource,
    /const parsed = new NativeURL\(String\(value \|\| ''\), location\.href\);/,
  );
  assert.match(
    lifecycleSource,
    /parsed\.protocol === 'https:'/,
  );
  assert.match(
    lifecycleSource,
    /targetHost === 'stationhead\.com' \|\| targetHost\.endsWith\('\.stationhead\.com'\)/,
  );
  assert.doesNotMatch(
    lifecycleSource,
    /kRelevantUrlFixed[\s\S]*\/\(\^\|\\\.\)stationhead\\\.com\/i\.test/,
  );
});

test('fetch URL objects and Request URLs remain observable', () => {
  assert.match(
    lifecycleSource,
    /NativeURL && input instanceof NativeURL \? input\.href/,
  );
  assert.match(
    lifecycleSource,
    /\(input && input\.url\) \|\| ''/,
  );
  assert.match(
    lifecycleSource,
    /#undef StationheadAuthCaptureScript[\s\S]*#define StationheadAuthCaptureScript StationheadAuthCaptureScriptOriginFixed/,
  );
});
