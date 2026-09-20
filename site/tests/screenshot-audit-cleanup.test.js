import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const cleanup = readFileSync(new URL('../public/screenshot-audit-cleanup.css', import.meta.url), 'utf8');

test('screenshot audit cleanup loads with the dashboard and fixes the shared listening-party label', () => {
  assert.match(header, /screenshot-audit-cleanup\.css\?v=20260919\.3/);
  assert.match(header, /\[data-mode="broadcasts"\]/);
  assert.match(header, /textContent = '公式リスパ'/);
});

test('duplicate and verbose data surfaces are compacted without hiding primary tables', () => {
  assert.match(cleanup, /#rankingWeeklyPanel\s*\{[\s\S]*display:\s*none\s*!important/);
  assert.match(cleanup, /#likesRankingList \.like-rank-item:nth-child\(n \+ 11\)/);
  assert.match(cleanup, /\.chart-foot\s*\{[\s\S]*display:\s*none\s*!important/);
  assert.match(cleanup, /#chartLegend span\s*\{[\s\S]*text-overflow:\s*ellipsis/);
  assert.doesNotMatch(cleanup, /#tbody|#likesTbody|\.table-wrap\s*\{[^}]*display:\s*none/);
});
