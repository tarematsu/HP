import { browserSource } from './helpers/dashboard-source.js';
import { dashboardRouterSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const stationheadModel = readFileSync(new URL('../public/stationhead-channel-model.js', import.meta.url), 'utf8');
const stationheadRuntime = browserSource('stationhead-channel.js');
const tabsClient = dashboardRouterSource();

test('shared Stationhead subtabs switch local panels while aggregate views use the function router', () => {
  for (const mode of ['history', 'broadcasts']) {
    assert.match(stationheadModel, new RegExp(`value: '${mode}'`));
  }
  assert.match(stationheadRuntime, /button\.addEventListener\('click', \(\) => selectSection\(runtime, button\.dataset\.stationheadSection\)\)/);
  assert.match(stationheadRuntime, /panel\.hidden = panel\.dataset\.stationheadPanel !== section/);
  assert.match(tabsClient, /mode: 'ranking', label: 'リーダーボード'/);
  assert.match(tabsClient, /event\.target\.closest\('button\[data-mode\]'/);
  assert.match(tabsClient, /activateMode\(button\.dataset\.mode\)/);
  assert.doesNotMatch(tabsClient, /return button\?\.dataset\.view \|\| button\?\.dataset\.mode/);
});
