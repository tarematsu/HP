import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panelState = readFileSync(
  new URL('../../native/src/renderer_panel_state.cpp', import.meta.url),
  'utf8',
);
const sensorSerial = readFileSync(
  new URL('../../native/src/sensors_serial.cpp', import.meta.url),
  'utf8',
);
const lifecycle = readFileSync(
  new URL('../../native/src/renderer_lifecycle.cpp', import.meta.url),
  'utf8',
);
const airHistory = readFileSync(
  new URL('../../native/src/app_air_history.cpp', import.meta.url),
  'utf8',
);

test('air sensor acquisition remains one consolidated sample per minute', () => {
  assert.match(sensorSerial, /kSensorReadInterval = std::chrono::minutes\(1\)/);
  assert.match(sensorSerial, /sample\.co2 = co2;/);
  assert.match(sensorSerial, /sample\.humidity = humidity;/);
  assert.match(sensorSerial, /sample\.temperature = temperature;/);
});

test('air stats repaint only after user-visible deltas', () => {
  assert.match(panelState, /kAirStatsCo2InvalidateDeltaPpm = 5/);
  assert.match(panelState, /kAirStatsTemperatureInvalidateDeltaC = 0\.1/);
  assert.match(panelState, /kAirStatsHumidityInvalidateDeltaPercent = 1\.0/);
  assert.match(panelState, /const bool repaintAirStats = AirStatsNeedRepaint\(nativeSensors_, sensors\)/);
  assert.match(panelState, /if \(!repaintAirStats \|\| !nativeDashboardVisible_/);
});

test('air graph projection advances incrementally for normal five-minute history updates', () => {
  assert.match(airHistory, /kAirHistoryBucketMs = 5LL \* 60 \* 1000/);
  assert.match(panelState, /const bool appended = history\.size\(\) == nativeAirHistory_\.size\(\) \+ 1/);
  assert.match(panelState, /const bool rolled = history\.size\(\) == nativeAirHistory_\.size\(\)/);
  assert.match(panelState, /nativeAirGraph_\.samples\.push_back\(history\.back\(\)\)/);
  assert.match(panelState, /if \(!incremental \|\| nativeAirGraph_\.samples\.empty\(\)\)/);
});

test('hidden dashboard suspends native panel timer and air graph rendering work', () => {
  assert.match(lifecycle, /KillTimer\(nativeMainWindow_, kNativePanelTickTimer\)/);
  assert.match(panelState, /if \(!nativeDashboardVisible_\) \{[\s\S]*nativeAirGraph_ = \{\};[\s\S]*return;/);
});
