import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panelStateSource = readFileSync(
  new URL('../../native/src/renderer_panel_state.cpp', import.meta.url),
  'utf8',
);

test('Stationhead status remains cached without repainting the radar card', () => {
  assert.match(
    panelStateSource,
    /const bool stationheadChanged = nativeStationhead_ != state\.stationhead;/,
  );
  assert.match(
    panelStateSource,
    /if \(stationheadChanged\) nativeStationhead_ = state\.stationhead;/,
  );
  assert.doesNotMatch(panelStateSource, /PanelSection::Music/);
  const updateFunction = panelStateSource.match(
    /void Renderer::UpdateNativeStaticPanels\([\s\S]*?\n\}/,
  )?.[0] ?? '';
  assert.doesNotMatch(updateFunction, /PanelSection::Radar/);
  assert.doesNotMatch(
    panelStateSource,
    /const bool stationheadChanged =[\s\S]{0,500}nativeStationhead_\.contentRevision !=/,
  );
});
