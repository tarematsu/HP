import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const cleanup = readFileSync(new URL('../public/screenshot-audit-cleanup.css', import.meta.url), 'utf8');

test('screenshot audit cleanup loads with the dashboard while the listening-party label is static', () => {
  assert.match(header, /screenshot-audit-cleanup\.css\?v=20260919\.3/);
  assert.match(page, /data-mode="broadcasts">公式リスパ/);
  assert.doesNotMatch(header, /\[data-mode="broadcasts"\]|textContent = '公式リスパ'/);
});

test('duplicate and verbose data surfaces are compacted without hiding primary tables', () => {
  assert.match(cleanup, /#rankingWeeklyPanel\s*\{[\s\S]*display:\s*none\s*!important/);
  assert.match(cleanup, /#likesRankingList \.like-rank-item:nth-child\(n \+ 11\)/);
  assert.match(cleanup, /\.chart-foot\s*\{[\s\S]*display:\s*none\s*!important/);
  assert.match(cleanup, /#chartLegend span\s*\{[\s\S]*text-overflow:\s*ellipsis/);
  assert.doesNotMatch(cleanup, /#tbody|#likesTbody|\.table-wrap\s*\{[^}]*display:\s*none/);
});
