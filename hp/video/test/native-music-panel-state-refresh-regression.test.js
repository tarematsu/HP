import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const panelStateSource = readFileSync(
  new URL('../../native/src/renderer_panel_state.cpp', import.meta.url),
  'utf8',
);

test('Music panel refreshes for every rendered Stationhead status change', () => {
  assert.match(
    panelStateSource,
    /const bool stationheadChanged = nativeStationhead_ != state\.stationhead;/,
  );
  assert.match(
    panelStateSource,
    /if \(stationheadChanged\) nativeStationhead_ = state\.stationhead;/,
  );
  assert.match(
    panelStateSource,
    /if \(stationheadChanged \|\| stationheadHistoryChanged\)[\s\S]*PanelSection::Music/,
  );
  assert.doesNotMatch(
    panelStateSource,
    /const bool stationheadChanged =[\s\S]{0,500}nativeStationhead_\.contentRevision !=/,
  );
});
