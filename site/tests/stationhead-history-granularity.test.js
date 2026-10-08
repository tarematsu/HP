import { browserSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const controls = readFileSync(new URL('../public/stationhead-history-granularity.js', import.meta.url), 'utf8');
const readModel = browserSource('stationhead-channel-read-model.js');
const css = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');

test('shared Stationhead history table switches daily and weekly read models', () => {
  assert.match(shell, /data-history-table-mode="daily"/);
  assert.match(shell, /data-history-table-mode="weekly"/);
  assert.match(controls, /model\.setHistoryMode\(mode\)/);
  assert.match(readModel, /\/api\/history\?mode=\$\{mode\}/);
  assert.match(readModel, /payload\?\.\[mode\]/);
  assert.doesNotMatch(controls, /reduce\(|listener_avg\s*\*/);
});

test('all Stationhead history gaps use one shared gray treatment', () => {
  assert.match(controls, /export function historyMissingRanges/);
  assert.match(controls, /periodMs \* 1\.5/);
  assert.match(controls, /stationhead-history-gap-band/);
  assert.match(controls, /欠測（灰色）/);
  assert.match(css, /stationhead-history-gap-band/);
  assert.match(css, /rgba\(100, 107, 116, \.18\)/);
});

test('shared Stationhead shell remains channel-neutral', () => {
  assert.doesNotMatch(shell, /buddies|ohisama|nogizaka|櫻坂46|日向坂46|乃木坂46/i);
});
