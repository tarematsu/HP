import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/hinata-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/hinata.js', import.meta.url), 'utf8');
const followersShell = readFileSync(new URL('../public/followers-shell.js', import.meta.url), 'utf8');

test('Ohisama and followers chart headers omit update-time pills', () => {
  assert.doesNotMatch(shell, /hinataUpdated|更新時間|JST文字列/);
  assert.doesNotMatch(followersShell, /followersLatestDate/);
  assert.match(entry, /hinata-shell\.js\?v=20261001\.2/);
  assert.match(entry, /followers-shell\.js\?v=20261001\.1/);
});

test('Ohisama daily Canvas marks date gaps with the same missing-period treatment as history', () => {
  assert.doesNotMatch(shell, /hinata-missing-periods\.js/);
  assert.match(runtime, /const MISSING_FILL = 'rgba\(100, 107, 116, \.16\)'/);
  assert.match(runtime, /const MISSING_KEY = 'rgba\(100, 107, 116, \.55\)'/);
  assert.match(runtime, /gap <= DAY_MS \* 1\.5/);
  assert.match(runtime, /context\.fillRect\(left, area\.top, Math\.max\(1, right - left\), area\.height\)/);
  assert.match(runtime, /appendLegend\('欠測', MISSING_KEY, 'period-missing-band'\)/);
  assert.match(runtime, /灰色は欠測期間です/);
});