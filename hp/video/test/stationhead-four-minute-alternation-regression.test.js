import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appState = readFileSync(
  new URL('../../native/src/app_stationhead_state.cpp', import.meta.url),
  'utf8',
);

function selectedWindowAt(milliseconds) {
  const halfMinuteSlot = Math.floor(milliseconds / 30_000);
  const slotInFourMinuteCycle = halfMinuteSlot % 8;
  if (slotInFourMinuteCycle === 0) return 'A';
  if (slotInFourMinuteCycle === 1) return 'B';
  return null;
}

test('both Stationhead windows change only once per four-minute cycle', () => {
  assert.equal(selectedWindowAt(0), 'A');
  assert.equal(selectedWindowAt(30_000), 'B');
  assert.equal(selectedWindowAt(60_000), null);
  assert.equal(selectedWindowAt(3 * 60_000 + 30_000), null);
  assert.equal(selectedWindowAt(4 * 60_000), 'A');
  assert.equal(selectedWindowAt(4 * 60_000 + 30_000), 'B');
  assert.equal(selectedWindowAt(8 * 60_000), 'A');
  assert.equal(selectedWindowAt(8 * 60_000 + 30_000), 'B');
});

test('native switch handler gates the half-minute timer to four-minute events', () => {
  assert.match(appState, /kStationheadClockSlotMs = 30'000/);
  assert.match(appState, /kStationheadClockCycleSlots = 8/);
  assert.match(
    appState,
    /kStationheadClockCycleSlots \* kStationheadClockSlotMs == 4 \* 60'000/,
  );
  assert.match(
    appState,
    /slotInFourMinuteCycle =\s*clockSlot % kStationheadClockCycleSlots/,
  );
  assert.match(
    appState,
    /slotInFourMinuteCycle != 0 && slotInFourMinuteCycle != 1[\s\S]*return/,
  );
  assert.match(appState, /const bool switchPrimary = \(clockSlot % 2\) == 0/);
});

test('four-minute gate runs before navigation and playback-cache checks', () => {
  const gate = appState.indexOf('slotInFourMinuteCycle != 0');
  const pending = appState.indexOf('stationheadClockPendingAudioWindow_ >= 0');
  const playbackCache = appState.indexOf('StationheadPrimaryPlaybackAvailableCached()');
  const navigation = appState.indexOf('SwitchClockStationDestination(targetUrl, reason)');

  assert.notEqual(gate, -1);
  assert.ok(gate < pending);
  assert.ok(gate < playbackCache);
  assert.ok(gate < navigation);
});
