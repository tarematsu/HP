import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rendererHeader = readFileSync(
  new URL('../../native/src/web_renderer.h', import.meta.url),
  'utf8',
);
const panelState = readFileSync(
  new URL('../../native/src/renderer_panel_state.cpp', import.meta.url),
  'utf8',
);
const environment = readFileSync(
  new URL('../../native/src/renderer_panels/environment_sections.inc', import.meta.url),
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
  assert.match(panelState, /if \(!AirStatsNeedRepaint\(nativeSensors_, sensors\)\) return;/);
  assert.match(panelState, /nativeSensors_ = sensors;/);
});

test('air graph renders directly from the single stored history vector', () => {
  assert.match(airHistory, /kAirHistoryBucketMs = 5LL \* 60 \* 1000/);
  assert.match(panelState, /nativeAirHistory_ = history;/);
  assert.match(environment, /const auto& samples = nativeAirHistory_;/);
  assert.match(environment, /const int64_t cutoff = UnixMillis\(\) - kWindowMs;/);
  assert.doesNotMatch(rendererHeader, /AirGraphProjection|nativeAirGraph_|RebuildNativeAirGraph/);
  assert.doesNotMatch(panelState, /RebuildNativeAirGraph|nativeAirGraph_/);
});

test('hidden dashboard suspends air repaint work without a second graph cache', () => {
  assert.match(lifecycle, /KillTimer\(nativeMainWindow_, kNativePanelTickTimer\)/);
  assert.match(panelState, /if \(!nativeDashboardVisible_ \|\| !EnsureNativeStaticWindows\(\)\) return;/);
  assert.doesNotMatch(lifecycle, /RebuildNativeAirGraph|nativeAirGraph_/);
});
