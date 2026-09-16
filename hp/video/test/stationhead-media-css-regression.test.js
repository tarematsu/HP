import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const startup = source('sh_startup_script.h');
const room = source('sh_room_ui_reduction_policy.h');
const resources = source('sh_startup_resource_reduction_policy_fix.h');
const finalResources = source('sh_runtime_script_resource_policy_fix.h');

test('Stationhead startup separates every composed IIFE explicitly', () => {
  const separators = startup.match(/script\.append\(L";\\n"\)/g) || [];
  assert.equal(separators.length, 2);
  assert.match(startup, /script\.push_back\(L';'\)/);
  assert.match(
    startup,
    /StationheadCompactRuntimeScript[\s\S]*StationheadRenderReductionScript[\s\S]*StationheadRoomUiReductionScript/,
  );
});

test('Stationhead room CSS recognizes the production channel route', () => {
  assert.match(room, /parts\.length === 2/);
  assert.match(room, /parts\[0\]\.toLowerCase\(\) === 'c'/);
  assert.match(room, /channelRoom/);
  assert.match(room, /__homepanelStationheadRoomUiReduction/);
  assert.match(room, /data-homepanel-stationhead-playback-only/);
});

test('Stationhead resource reduction never blocks media', () => {
  assert.doesNotMatch(
    resources,
    /addFilter\(COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA\)/,
  );
  assert.doesNotMatch(
    resources,
    /!StationheadCorePlaybackRequestBoundaryFixed\(lower\)/,
  );
  assert.match(
    resources,
    /context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA\)[\s\S]*return S_OK/,
  );

  // The final active layer leaves UDF-owned image/font suppression alone.
  assert.doesNotMatch(finalResources, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_(?:IMAGE|FONT)/);
  assert.match(finalResources, /COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT/);
  assert.match(finalResources, /StationheadExpandedNonPlaybackScriptBoundaryFixed/);
});
