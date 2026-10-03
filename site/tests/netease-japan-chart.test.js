import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/regional-music-shell.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/netease-japan-chart-ui.js', import.meta.url), 'utf8');

test('网易云音乐 is hidden from subscription tabs while chart UI remains available internally', () => {
  assert.doesNotMatch(index, /data-source="netease_cloud_music"/);
  assert.doesNotMatch(index, /netease-japan-chart-ui\.js/);
  assert.match(shell, /import\('\.\/netease-japan-chart-ui\.js\?v=20261003\.1'\)/);
  assert.match(ui, /网易云日语榜 グループ別最高順位推移/);
  assert.match(ui, /网易云日语榜 ランクイン履歴/);
  assert.doesNotMatch(ui, /NetEase Cloud Music 日語榜/);
});

test('网易云日语榜 renders stored no-match weeks as out of chart', () => {
  assert.match(ui, /OUT_OF_CHART_RANK = 101/);
  assert.match(ui, /byPeriod\.get\(period\)\?\.rank \?\? OUT_OF_CHART_RANK/);
  assert.match(ui, /rank===OUT_OF_CHART_RANK \? '圏外'/);
});
