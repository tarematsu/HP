import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';


const stationheadLifecycle = readFileSync(
  new URL('../../native/src/sh_runtime_lifecycle_script.h', import.meta.url),
  'utf8',
);

test('Stationhead always applies 50% document zoom without size-dependent switching', () => {
  assert.match(
    stationheadLifecycle,
    /document\.documentElement\?\.style\.setProperty\('zoom', '0\.5'\)/,
  );
  assert.doesNotMatch(
    stationheadLifecycle,
    /innerWidth > 1|innerHeight > 1|window\.addEventListener\('resize'/,
  );
  assert.match(
    stationheadLifecycle,
    /window\.addEventListener\('pageshow',[\s\S]*zoomOut\(\)/,
  );
});
