import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL('../../native/src/cloud_client.h', import.meta.url), 'utf8');
const client = readFileSync(
  new URL('../../native/src/cloud_client.cpp', import.meta.url), 'utf8');
const sync = readFileSync(
  new URL('../../native/src/cloud_client_sync.cpp', import.meta.url), 'utf8');

test('unchanged, previously verified device config avoids disk read and JSON decode', () => {
  assert.match(header, /struct DeviceConfigValidatedStamp/);
  assert.match(header, /fs::file_time_type modifiedAt\{\}/);
  assert.match(header, /int version = -1;/);
  assert.match(header, /bool valid = false;/);
  const begin = sync.indexOf('  const auto requestedDeviceConfigVersion =');
  const end = sync.indexOf('  const fs::path representativeRadarPath', begin);
  assert.ok(begin >= 0 && end > begin);
  const body = sync.slice(begin, end);
  const early = body.indexOf('deviceConfigValidatedStamp_.valid &&');
  const diskRead = body.indexOf('std::ifstream input(deviceConfigPath');
  const parser = body.indexOf('JsonObject::Parse(Utf8ToWide(text))');
  assert.ok(early >= 0 && early < diskRead && diskRead < parser,
    'previously verified file stamp must be checked before reading and parsing JSON');
  assert.match(body, /fs::file_size\(deviceConfigPath, stampError\)/);
  assert.match(body, /fs::last_write_time\(deviceConfigPath, stampError\)/);
  assert.match(body, /deviceConfigValidatedStamp_\.version == deviceConfigVersion_/);
  assert.match(body, /deviceConfigValidatedStamp_\.size == size/);
  assert.match(body, /deviceConfigValidatedStamp_\.modifiedAt == modifiedAt/);
  assert.match(body, /deviceConfigValidatedStamp_ = \{\s*size, modifiedAt, deviceConfigVersion_, true\}/);
  assert.match(body, /return deviceConfigVersion_;/);
});

test('device config missing, changed, wrong-device and invalid-version cache forces refresh', () => {
  const start = sync.indexOf('  const auto requestedDeviceConfigVersion =');
  const end = sync.indexOf('  const fs::path representativeRadarPath', start);
  const body = sync.slice(start, end);
  assert.match(body, /if \(deviceConfigVersion_ < 0\) \{\s*deviceConfigValidatedStamp_\.valid = false;\s*return -1;/);
  assert.match(body, /if \(stampError \|\| size == 0\) \{\s*deviceConfigValidatedStamp_\.valid = false;/);
  assert.match(body, /if \(stampError\) \{\s*deviceConfigValidatedStamp_\.valid = false;/);
  assert.match(body, /static_cast<int>\(version\) != deviceConfigVersion_/);
  assert.match(body, /deviceId != config_\.deviceId/);
  assert.match(body, /!envelope\.HasKey\(L"config"\)/);
  assert.match(body, /ValueType\(\) != JsonValueType::Object/);
  assert.match(body, /catch \(\.\.\.\) \{[\s\S]*deviceConfigValidatedStamp_\.valid = false;[\s\S]*forcing refresh/);
  assert.match(sync, /std::to_wstring\(requestedDeviceConfigVersion\(\)\)/);
  const cacheMatches = (cached, version, stat) =>
    cached.valid && cached.version === version &&
    cached.size === stat.size && cached.modifiedAt === stat.modifiedAt;
  const cached = { valid: true, version: 7, size: 158, modifiedAt: 1350 };
  assert.equal(cacheMatches(cached, 7, { size: 158, modifiedAt: 1350 }), true);
  assert.equal(cacheMatches(cached, 8, { size: 158, modifiedAt: 1350 }), false);
  assert.equal(cacheMatches(cached, 7, { size: 158, modifiedAt: 1351 }), false);
  assert.equal(cacheMatches(cached, 7, { size: 159, modifiedAt: 1350 }), false);
  assert.equal(cacheMatches({ ...cached, valid: false }, 7, { size: 158, modifiedAt: 1350 }), false);
});

test('only the first pending cloud refresh wakes the polling thread', () => {
  const start = client.indexOf('void CloudClient::RefreshNow() {');
  const end = client.indexOf('std::wstring CloudClient::LastSuccessText()', start);
  assert.ok(start >= 0 && end > start);
  const body = client.slice(start, end);
  assert.match(body, /immediate_\.exchange\(true, std::memory_order_acq_rel\)/);
  assert.match(body, /std::lock_guard lock\(wakeMutex_\)/);
  assert.match(body, /notify = !immediate_\.exchange\(true, std::memory_order_acq_rel\)/);
  assert.match(body, /if \(notify\) wake_\.notify_one\(\)/);
  const lock = body.indexOf('std::lock_guard lock(wakeMutex_)');
  const predicate = body.indexOf('notify = !immediate_.exchange(');
  const wake = body.indexOf('if (notify) wake_.notify_one()');
  assert.ok(lock >= 0 && lock < predicate && predicate < wake);
  assert.doesNotMatch(body, /wake_\.notify_all\(\)/);

  // A callback after the worker consumes the pending bit still wakes it.
  let pending = false;
  let wakes = 0;
  const refresh = () => {
    if (!pending) { pending = true; wakes++; }
  };
  for (let i = 0; i < 100; i++) refresh();
  assert.equal(wakes, 1);
  pending = false;  // consumed by the worker's wait predicate
  refresh();
  assert.equal(wakes, 2);
  assert.equal(pending, true);

  assert.match(client, /wake_\.wait_for\(lock, std::chrono::seconds\(seconds\), \[this\] \{ return stopping_\.load\(\) \|\| immediate_\.exchange\(false\); \}\)/);
  assert.match(client, /void CloudClient::Stop\(\)[\s\S]*wake_\.notify_all\(\)/);
});


test('replayed cloud payloads keep versions without unnecessary file writes or UI paints', () => {
  const helperStart = sync.indexOf('CacheWriteResult WriteCacheIfChanged(');
  const helperEnd = sync.indexOf('void CloudClient::ApplyPresenceFallback()', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = sync.slice(helperStart, helperEnd);
  assert.match(helper, /fs::file_size\(path, error\)/);
  assert.match(helper, /existingSize == bytes\.size\(\)/);
  assert.match(helper, /std::array<char, 8192> chunk/);
  assert.match(helper, /std::memcmp\(chunk\.data\(\), bytes\.data\(\) \+ offset, count\) != 0/);
  assert.match(helper, /if \(equal\) return CacheWriteResult::Unchanged/);
  assert.match(helper, /AtomicWriteBytes\(path, bytes\)/);

  for (const [source, label, applied, message] of [
    ['dashboardPath', 'dashboard', 'dashboardApplied', 'WM_HP_CLOUD_UPDATED'],
    ['radarPath', 'radar', 'radarApplied', 'WM_HP_RADAR_UPDATED'],
    ['switchbotPath', 'SwitchBot', 'switchbotApplied', 'WM_HP_SWITCHBOT_UPDATED'],
    ['deviceConfigPath', 'device config', 'configApplied', 'WM_HP_CONFIG_UPDATED'],
  ]) {
    const start = sync.indexOf('WriteCacheIfChanged(' + source);
    assert.ok(start >= 0, label + ' must use the shared dedupe writer');
    const piece = sync.slice(start, start + 460);
    assert.match(piece, /CacheWriteResult::Failed/);
    assert.match(piece, new RegExp(applied + ' = true;'));
    assert.match(piece, new RegExp('if \\(written == CacheWriteResult::Written\\) \\{\\s*PostMessageW\\(window_, ' + message));
  }

  // Equal data does not require a write, but a missing/changed target does.
  const shouldWrite = (existing, next) => existing === null ||
    !Buffer.from(existing).equals(Buffer.from(next));
  assert.equal(shouldWrite('abc', 'abc'), false);
  assert.equal(shouldWrite('abc', 'abd'), true);
  assert.equal(shouldWrite(null, 'abc'), true);
  assert.equal(shouldWrite('abc', 'abcd'), true);
});
