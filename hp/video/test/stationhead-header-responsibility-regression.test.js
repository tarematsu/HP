import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const player = source('sh.h');
const timing = source('monotonic_time.h');
const types = source('stationhead_types.h');
const fallbackGate = source('stationhead_fallback_revision_gate.h');
const app = source('app.h');

test('Stationhead player header owns player state instead of shared support types', () => {
  assert.match(player, /#include "monotonic_time\.h"/);
  assert.match(player, /#include "stationhead_types\.h"/);
  assert.match(player, /class StationheadPlayer/);
  assert.doesNotMatch(player, /class MonotonicElapsedTimestamp/);
  assert.doesNotMatch(player, /struct StationheadStatus/);
  assert.doesNotMatch(player, /class StationheadFallbackRevisionGate/);
});

test('monotonic timing primitives are isolated from Stationhead domain state', () => {
  assert.match(timing, /class MonotonicElapsedTimestamp/);
  assert.match(timing, /class AtomicMonotonicElapsedTimestamp/);
  assert.match(timing, /class MonotonicDeadline/);
  assert.match(timing, /class StartupAwareWakeDeadline/);
  assert.doesNotMatch(timing, /StationheadStatus|StationheadDailyPlayPoint/);
});

test('Stationhead DTOs are isolated from WebView player implementation details', () => {
  assert.match(types, /enum class StationheadTabKind/);
  assert.match(types, /enum StationheadChangeFlags/);
  assert.match(types, /struct StationheadDailyPlayPoint/);
  assert.match(types, /struct StationheadStatus/);
  assert.doesNotMatch(types, /ICoreWebView2|StationheadPlayer/);
});

test('App fallback revision policy lives outside App declaration', () => {
  assert.match(app, /#include "stationhead_fallback_revision_gate\.h"/);
  assert.doesNotMatch(app, /class StationheadFallbackRevisionGate/);
  assert.match(fallbackGate, /class StationheadFallbackRevisionGate/);
  assert.match(fallbackGate, /kStationheadFallbackMinimumDwellMs/);
});
