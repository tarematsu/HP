import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panelStateSource = readFileSync(
  new URL('../../native/src/renderer_panel_state.cpp', import.meta.url),
  'utf8',
);

test('Stationhead status remains cached without retired panel work', () => {
  const updateFunction = panelStateSource.match(
    /void Renderer::UpdateNativeStaticPanels\([\s\S]*?\n\}/,
  )?.[0] ?? '';
  assert.match(
    updateFunction,
    /if \(nativeStationhead_ != state\.stationhead\) \{[\s\S]*nativeStationhead_ = state\.stationhead;/,
  );
  assert.doesNotMatch(updateFunction, /stationheadPlayHistory|PanelSection::Radar|PanelSection::Music/);
  assert.doesNotMatch(panelStateSource, /GlobalStationheadNativeStatsStore|StationheadRevisionCache/);
});
