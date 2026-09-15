import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cmake = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url), 'utf8');
const policy = readFileSync(
  new URL('../../native/src/sh_auth_capture_origin_policy.h', import.meta.url), 'utf8');

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('auth capture origin policy has an explicit PCH slot', () => {
  assert.match(cmake, /src\/sh_auth_capture_origin_policy\.h/);
  assert.doesNotMatch(cmake, /sh_runtime_lifecycle_policy_fix\.h/);
});

test('auth capture policy owns no playback lifecycle work', () => {
  assert.doesNotMatch(policy, /StationheadAutoplayScript|setInterval|setTimeout|MutationObserver|pagehide|pageshow/);
  assert.doesNotMatch(policy, /#define StationheadAutoplayScript/);
});

test('source rewrite helper is scoped to authentication capture', () => {
  assert.match(policy, /inline bool ReplaceStationheadAuthCaptureFragment\(/);
  assert.match(policy, /script\.find\(from\)/);
  assert.match(policy, /script\.replace\(at, from\.size\(\), to\)/);
  assert.doesNotMatch(policy, /ReplaceStationheadRuntimeFragment/);
});

test('authentication capture is restricted to top-level trusted HTTPS Stationhead URLs', () => {
  const auth = section(
    policy,
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
    policy,
    /#define StationheadAuthCaptureScript StationheadAuthCaptureScriptOriginFixed/,
  );
});
