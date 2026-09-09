import assert from 'node:assert/strict';
import test from 'node:test';

function correctedClock(windowsUnixMs, persistedOffsetMs) {
  return windowsUnixMs + persistedOffsetMs;
}

test('persisted positive offset corrects a slow Windows clock while offline', () => {
  const trueNetworkTime = 1_800_000_000_000;
  const windowsTime = trueNetworkTime - 60_000;
  const persistedOffset = trueNetworkTime - windowsTime;
  assert.equal(correctedClock(windowsTime, persistedOffset), trueNetworkTime);
});

test('persisted negative offset corrects a fast Windows clock while offline', () => {
  const trueNetworkTime = 1_800_000_000_000;
  const windowsTime = trueNetworkTime + 45_000;
  const persistedOffset = trueNetworkTime - windowsTime;
  assert.equal(correctedClock(windowsTime, persistedOffset), trueNetworkTime);
});
