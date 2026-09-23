import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const startup = source('sh_startup_script.h');
const room = source('sh_room_ui_reduction_policy.h');

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

test('pre-playback room CSS never hides generic reusable button class bundles', () => {
  assert.doesNotMatch(room, /button--full-width/);
  assert.doesNotMatch(room, /cursor-pointer[^\n]*flex-col[^\n]*items-center/);
  assert.doesNotMatch(room, /border-borderRoom[^\n]*caption-2-semibold/);
  assert.match(room, /a\[aria-label='Open threads'\]/);
  assert.match(room, /button\[aria-label='View streaming party details'\]/);
});
