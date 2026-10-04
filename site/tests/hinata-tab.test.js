import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const route = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const shellWrapper = readFileSync(new URL('../public/hinata-shell.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/stationhead-channel.js', import.meta.url), 'utf8');
const readModel = readFileSync(new URL('../public/stationhead-channel-read-model.js', import.meta.url), 'utf8');
const stationheadModel = readFileSync(new URL('../public/stationhead-channel-model.js', import.meta.url), 'utf8');
const sharedUi = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../functions/api/hinata.js', import.meta.url), 'utf8');

test('Pages keeps Ohisama behind the shared lazy dashboard route', () => {
  assert.doesNotMatch(metrics, /hinata-shell\.js/);
  assert.match(route, /hinata:\s*\{/);
  assert.match(route, /shell: \(\) => import\('\/hinata-shell\.js\?v=/);
  assert.match(route, /id: 'hinata', label: 'Ohisama', defaultMode: 'hinata'/);
  assert.match(route, /viewId: 'hinataView'/);
  assert.match(shellWrapper, /mountStationheadChannelShell/);
  assert.match(shellWrapper, /id: 'hinataView'/);
  assert.match(shellWrapper, /stationheadModel = 'ohisama'/);
});

test('Ohisama, Buddies and Nogizaka use the same Stationhead HTML shell', () => {
  for (const section of ['current', 'history', 'played-tracks', 'likes', 'broadcasts']) {
    assert.match(stationheadModel, new RegExp(`value: '${section}'`));
    assert.match(shell, new RegExp(`data-stationhead-panel=\\"${section}\\"`));
  }
  assert.match(shell, /stationheadChannelMarkup/);
  assert.match(shell, /dashboardModeTabs/);
  assert.match(sharedUi, /export function mountDashboardView/);
  assert.doesNotMatch(shell, /hinata|ohisama|nogizaka|buddies/i);
});

test('Ohisama charts and tables are rendered by the shared Stationhead runtime', () => {
  assert.match(runtime, /dashboard-chart-canvas\.js\?v=20261001\.2/);
  assert.match(runtime, /prepareDashboardCanvas/);
  assert.match(runtime, /function renderCurrentChart\(/);
  assert.match(runtime, /function renderDaily\(/);
  assert.match(runtime, /listener_avg/);
  assert.match(runtime, /listener_min/);
  assert.match(runtime, /listener_max/);
  assert.match(runtime, /stream_growth/);
  assert.match(runtime, /member_growth/);
  assert.match(runtime, /appendEmptyTableRow\(body, '日次データはまだありません。', 10\)/);
  assert.match(shell, /再生数増加/);
  assert.match(shell, /5分単位/);
});

test('Ohisama frontend difference is isolated to the materialized read-model adapter', () => {
  assert.match(readModel, /function ohisamaModel\(\)/);
  assert.match(readModel, /fetchJson\('\/api\/hinata'/);
  assert.match(readModel, /source: 'ohisama'/);
  assert.match(readModel, /capabilities: \['current', 'history', 'played-tracks', 'likes'\]/);
  assert.match(readModel, /payload\?\.queue/);
  assert.match(readModel, /payload\?\.played_history/);
  assert.match(readModel, /payload\.likes/);
  assert.match(readModel, /includes\('日向坂46'\)/);
  assert.doesNotMatch(runtime, /\/api\/hinata|日向坂46/);
});

test('Hinata public API remains read-model-only', () => {
  assert.match(api, /PAGES_READ_MODEL_SERVICE/);
  assert.match(api, /_internal\/pages-response/);
  assert.match(api, /HINATA_MODEL_KEY = 'hinata'/);
  assert.doesNotMatch(api, /\.prepare\(|OHISAMA_DB|MINUTE_DB|OTHER_DB/);
});
