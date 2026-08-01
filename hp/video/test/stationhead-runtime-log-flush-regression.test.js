import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const loggerSource = readFileSync(
  new URL('../../native/src/logger.cpp', import.meta.url),
  'utf8',
);

test('Stationhead lifecycle records are flushed without disabling general INFO buffering', () => {
  assert.match(
    loggerSource,
    /const bool observableLifecycle =[\s\S]*message\.rfind\(L"Stationhead ", 0\) == 0[\s\S]*message\.rfind\(L"Native dashboard started", 0\) == 0/,
  );
  assert.match(
    loggerSource,
    /if \(important \|\| observableLifecycle \|\|[\s\S]*pendingBytes_ >= kLogFlushThresholdBytes\)/,
  );
  assert.match(loggerSource, /output_\.flush\(\);[\s\S]*pendingBytes_ = 0;/);
  assert.match(loggerSource, /constexpr size_t kLogFlushThresholdBytes = 64 \* 1024;/);
  assert.doesNotMatch(loggerSource, /const bool important = true;/);
});
