import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../../native/src/cloud_client.cpp', import.meta.url), 'utf8');
function section(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}

test('unchanged offline dashboard errors do not rewrite the same cache or post UI updates', () => {
  const build = section('std::optional<std::vector<uint8_t>> DashboardWithCloudError(',
    'std::optional<std::vector<uint8_t>> StringPayload(');
  assert.match(build, /ReadTextFile\(path\)/);
  assert.match(build, /root\.HasKey\(L"__cloudError"\)/);
  assert.match(build, /root\.GetNamedValue\(L"__cloudError"\)\.ValueType\(\) == JsonValueType::String/);
  assert.match(build, /root\.GetNamedString\(L"__cloudError"\) == message/);
  assert.match(build, /return std::nullopt;/);
  assert.match(build, /root\.SetNamedValue\(L"__cloudError", JsonValue::CreateStringValue\(message\)\)/);
  const loop = section('void CloudClient::Loop() {', 'bool CloudClient::RequestRemoteRefresh() {');
  assert.match(loop, /if \(friendly != lastPublishedCloudError_\)/);
  assert.match(loop, /if \(!dashboard\) \{\s*lastPublishedCloudError_ = friendly;/);
  assert.match(loop, /else if \(AtomicWriteBytes\(dataDir_ \/ L"dashboard\.json", \*dashboard\)\)/);
  assert.match(loop, /lastPublishedCloudError_ = friendly;\s*PostMessageW\(window_, WM_HP_CLOUD_UPDATED/);
  assert.match(loop, /PostMessageW\(window_, WM_HP_CLOUD_UPDATED, 0, 0\)/);
  assert.match(loop, /const int count = \+\+failures_/);
  assert.match(loop, /ApplyPresenceFallback\(\)/);
  assert.match(loop, /dashboardVersion_ = -1;/);
});

test('offline changes preserve the first error, new error, and retry behavior', () => {
  let cached = null, writes = 0, notifications = 0;
  const failure = error => {
    if (cached?.__cloudError === error) return;
    cached = { ...cached, __cloudError: error };
    writes++; notifications++;
  };
  failure('WinHTTP unavailable');
  failure('WinHTTP unavailable');
  failure('WinHTTP unavailable');
  assert.deepEqual([writes, notifications], [1, 1]);
  failure('HTTP 401');
  assert.deepEqual([writes, notifications], [2, 2]);
  failure('HTTP 401');
  assert.deepEqual([writes, notifications], [2, 2]);
  cached = { updated: true };
  failure('HTTP 401');
  assert.deepEqual([writes, notifications], [3, 3],
    'a successful refresh followed by failure must publish the error again');
});
