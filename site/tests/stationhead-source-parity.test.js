import assert from 'node:assert/strict';
import test from 'node:test';
import { NAVIGATION, ROUTES } from '../public/dashboard-navigation-config.js';
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
    "role('history-csv')", "summaryItem('集計期間', 'history-periods')",
  ]) assert.ok(shell.includes(selector), selector);
  assert.match(client, /exportHistoryCsv\(runtime\)/);
  assert.match(client, /stationhead:history-mode/);
});

test('source differences are confined to read-model adapters and supported capabilities', () => {
  const read = (name) => readFileSync(new URL(`../public/stationhead/${name}-read-model.js`, import.meta.url), 'utf8');
  const [buddies, ohisama, nogizaka] = ['buddies','ohisama','nogizaka'].map(read);
  const factory = readFileSync(new URL('../public/stationhead/source-model.js', import.meta.url), 'utf8');
  for (const source of [buddies, ohisama, nogizaka]) {
    assert.ok(source.includes('createStationheadChannelModel({'));
    assert.ok(!source.includes('function normalizeCurrent'));
    assert.ok(!source.includes('function render'));
  }
  for (const key of ['loadCurrent', 'loadHistory', 'loadLikes', 'loadBroadcasts', 'setHistoryMode']) {
    assert.ok(factory.includes(key), `Shared model factory must own ${key}`);
  }
  assert.ok(buddies.includes("currentUrl: '/api/dashboard?history=0'"));
  assert.ok(ohisama.includes("currentUrl: '/api/hinata'"));
  assert.ok(nogizaka.includes("capabilities: ['broadcasts']"));
  assert.ok(ohisama.includes("capabilities: ['current', 'history', 'played-tracks', 'likes']"));
});
