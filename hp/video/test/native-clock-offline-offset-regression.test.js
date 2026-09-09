import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const fallback = readFileSync(
  new URL('../../native/src/network_clock_fallback.h', import.meta.url),
  'utf8',
);
const http = readFileSync(
  new URL('../../native/src/cloud_client_http.cpp', import.meta.url),
  'utf8',
);

test('native clock persists network-minus-Windows offset and restores it offline', () => {
  assert.match(fallback, /network-clock-offset-ms\.txt/);
  assert.match(fallback, /GetSystemTimeAsFileTime\(&fileTime\)/);
  assert.doesNotMatch(fallback, /GetLocalTime/);
  assert.match(
    fallback,
    /ReadNetworkClockOffset\(path, &offsetMs\)[\s\S]*WindowsWallClockUnixMillis\(&windowsUnixMs\)[\s\S]*AddNetworkClockOffset\(windowsUnixMs, offsetMs, &correctedUnixMs\)/,
  );
  assert.match(
    fallback,
    /clock\.anchorUnixMs = correctedUnixMs;[\s\S]*clock\.anchorTickMs = GetTickCount64\(\);[\s\S]*clock\.synchronized = true;/,
  );
  assert.match(
    fallback,
    /const int64_t networkUnixMs = serverUnixMs \+ 500;[\s\S]*const int64_t offsetMs = networkUnixMs - windowsUnixMs;/,
  );
  assert.match(fallback, /AtomicWriteText\(path, std::to_string\(offsetMs\) \+ "\\n"\)/);
  assert.match(fallback, /kNetworkClockOffsetPersistThresholdMs = 2000\.0L/);
});

test('cloud request restores fallback before networking and refreshes offset after HTTPS time sync', () => {
  assert.match(
    http,
    /std::call_once\(clockFallbackOnce,[\s\S]*BootstrapNetworkClockFromPersistedOffset\(\);[\s\S]*TryCompressedExchange/,
  );
  assert.match(
    http,
    /SynchronizeNetworkClockFromHttpResponse\(request\);\s*PersistNetworkClockOffsetFromHttpResponse\(request\);/,
  );
});
