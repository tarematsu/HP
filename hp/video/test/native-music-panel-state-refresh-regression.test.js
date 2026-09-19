import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panelStateSource = readFileSync(
  new URL('../../native/src/renderer_panel_state.cpp', import.meta.url),
  'utf8',
);

test('retired Stationhead panel compatibility cache is removed', () => {
  assert.doesNotMatch(panelStateSource, /UpdateNativeStaticPanels|nativeStationhead_|RenderState/);
  assert.doesNotMatch(
    panelStateSource,
    /stationheadPlayHistory|GlobalStationheadNativeStatsStore|StationheadRevisionCache/,
  );
});
