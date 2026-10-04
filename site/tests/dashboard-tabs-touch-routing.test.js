import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const stationheadModel = readFileSync(new URL('../public/stationhead-channel-model.js', import.meta.url), 'utf8');
const stationheadRuntime = readFileSync(new URL('../public/stationhead-channel.js', import.meta.url), 'utf8');
const tabsClient = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');

test('shared Stationhead subtabs switch local panels while leaderboard stays source-only', () => {
  for (const mode of ['history', 'broadcasts']) {
    assert.match(stationheadModel, new RegExp(`value: '${mode}'`));
  }
  assert.match(stationheadRuntime, /button\.addEventListener\('click', \(\) => selectSection\(runtime, button\.dataset\.stationheadSection\)\)/);
  assert.match(stationheadRuntime, /panel\.hidden = panel\.dataset\.stationheadPanel !== section/);
  assert.match(tabsClient, /id: 'ranking', label: 'リーダーボード', defaultMode: 'ranking'/);
  assert.match(tabsClient, /return button\?\.dataset\.mode \|\| button\?\.dataset\.view \|\| '';/);
  assert.match(tabsClient, /const mode = routeModeForButton\(button\);/);
  assert.doesNotMatch(tabsClient, /return button\?\.dataset\.view \|\| button\?\.dataset\.mode/);
});
