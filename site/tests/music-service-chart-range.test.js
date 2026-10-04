import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const qq = readFileSync(new URL('../public/qq-music.js', import.meta.url), 'utf8');
const kugou = readFileSync(new URL('../public/kugou-music.js', import.meta.url), 'utf8');

test('QQ and Kugou graph range starts in October 2020 without truncating history tables', () => {
  assert.match(qq, /CHART_START_DATE = '2020-10-01'/);
  assert.match(qq, /qqStoredPeriods\(chart, history\)\.filter\(\(\{ date \}\) => date >= CHART_START_DATE\)/);
  assert.match(qq, /const ordered = history\s+\.filter\(\(item\) => artistVisible/);

  assert.match(kugou, /CHART_START_DATE = '2020-10-01'/);
  assert.match(kugou, /chartHistory = history\.filter\(\(item\) => providerDate\(item\?\.published_at\) >= CHART_START_DATE\)/);
  assert.match(kugou, /const ordered = history\s+\.filter\(\(item\) => artistVisible/);
});