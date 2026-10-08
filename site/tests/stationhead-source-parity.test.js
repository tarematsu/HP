import assert from 'node:assert/strict';
import test from 'node:test';
import { NAVIGATION, ROUTES } from '../public/dashboard-navigation-config.js';
import { buddiesModel } from '../public/stationhead/buddies-read-model.js';
import { ohisamaModel } from '../public/stationhead/ohisama-read-model.js';
import { nogizakaModel } from '../public/stationhead/nogizaka-read-model.js';
import { readFileSync } from 'node:fs';

const shell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../public/stationhead-channel.js', import.meta.url), 'utf8');
const router = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');

test('Buddies and Ohisama use identical source tab labels and shared panels', () => {
  const [buddies, ohisama] = NAVIGATION[0].sources;
  assert.deepEqual(buddies.functions.map(({label}) => label),
    ['現在', '過去', '再生履歴', 'いいね', 'リスパ']);
  assert.deepEqual(ohisama.functions.map(({label}) => label),
    ['現在', '過去', '再生履歴', 'いいね']);
  for (const [source, viewId] of [[buddies, 'currentView'], [ohisama, 'hinataView']]) {
    for (const {mode} of source.functions.filter(item => item.label !== 'リスパ')) {
      assert.equal(ROUTES[mode].kind, 'stationhead');
      assert.equal(ROUTES[mode].viewId, viewId);
    }
  }
  assert.match(router, /STATIONHEAD_SHELLS/);
  assert.match(client, /selectStationheadChannelSection/);
});

test('shared history controls support daily and weekly, ranges, summary and CSV once', () => {
  for (const selector of [
    'data-history-range="30"', 'data-history-range="180"',
    'data-history-range="365"', 'data-history-range="all"',
    'data-history-table-mode="daily"', 'data-history-table-mode="weekly"',
    "role('history-csv')", "role('history-periods')",
  ]) assert.ok(shell.includes(selector), selector);
  assert.match(client, /exportHistoryCsv\(runtime\)/);
  assert.match(client, /stationhead:history-mode/);
});

test('source differences are confined to read-model adapters and supported capabilities', async () => {
  const models = [buddiesModel(), ohisamaModel(), nogizakaModel()];
  for (const model of models) {
    assert.equal(typeof model.loadCurrent, 'function');
    assert.equal(typeof model.loadHistory, 'function');
    assert.equal(typeof model.loadLikes, 'function');
    assert.equal(typeof model.loadBroadcasts, 'function');
    assert.equal(typeof model.setHistoryMode, 'function');
    assert.ok(Array.isArray(model.capabilities));
  }
  assert.deepEqual(models[0].capabilities.slice(0,4), models[1].capabilities);
  assert.deepEqual(models[2].capabilities, ['broadcasts']);
  assert.notEqual(models[0].meta.station_url, models[1].meta.station_url);
});
