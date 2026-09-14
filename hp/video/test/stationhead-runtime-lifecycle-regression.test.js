import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cmakeSource = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);
const lifecycleSource = readFileSync(
  new URL('../../native/src/sh_runtime_lifecycle_policy_fix.h', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('lifecycle header remains between runtime auth capture and resource policies', () => {
  assert.match(
    cmakeSource,
    /set\(HOMEPANEL_STATIONHEAD_SOURCES[\s\S]*src\/sh_runtime_policy_fix\.h[\s\S]*src\/sh_runtime_lifecycle_policy_fix\.h[\s\S]*src\/sh_runtime_resource_policy_fix\.h/,
  );
});

test('lifecycle header no longer owns startup timers or DOM observers', () => {
  assert.doesNotMatch(lifecycleSource, /StationheadAutoplayScriptLifecycleFixed/);
  assert.doesNotMatch(lifecycleSource, /setInterval|setTimeout|MutationObserver|pagehide|pageshow/);
  assert.doesNotMatch(lifecycleSource, /#define StationheadAutoplayScript/);
});

test('source rewrite helper is retained only for authentication policy composition', () => {
  assert.match(lifecycleSource, /inline bool ReplaceStationheadRuntimeFragment\(/);
  assert.match(lifecycleSource, /script\.find\(from\)/);
  assert.match(lifecycleSource, /script\.replace\(at, from\.size\(\), to\)/);
});

test('authentication capture remains restricted to top-level trusted HTTPS Stationhead URLs', () => {
  const auth = section(
    lifecycleSource,
    'inline std::wstring StationheadAuthCaptureScriptOriginFixed()',
    '}  // namespace hp',
  );
  assert.match(auth, /window\.top !== window/);
  assert.match(auth, /const NativeURL = window\.URL/);
  assert.match(auth, /parsed\.protocol === 'https:'/);
  assert.match(auth, /targetHost === 'stationhead\.com'/);
  assert.match(auth, /targetHost\.endsWith\('\.stationhead\.com'\)/);
  assert.match(auth, /NativeURL && input instanceof NativeURL/);
  assert.match(
    lifecycleSource,
    /#define StationheadAuthCaptureScript StationheadAuthCaptureScriptOriginFixed/,
  );
});
