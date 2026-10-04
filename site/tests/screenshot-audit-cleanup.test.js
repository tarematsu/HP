import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const stationheadModel = readFileSync(new URL('../public/stationhead-channel-model.js', import.meta.url), 'utf8');
const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const build = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');
const presentation = readFileSync(new URL('../public/dashboard-presentation.css', import.meta.url), 'utf8');

test('screenshot audit cleanup is part of the consolidated presentation layer while the listening-party label is static', () => {
  assert.match(build, /'dashboard-presentation\.css'/);
  assert.doesNotMatch(header, /dashboard-presentation\.css|createElement\('link'\)/);
  assert.match(stationheadModel, /value: 'broadcasts', label: 'リスパ'/);
  assert.doesNotMatch(header, /\[data-mode="broadcasts"\]|textContent = '(?:Listening Party|リスニングパーティ|リスパ)'/);
});

test('duplicate and verbose data surfaces are compacted without hiding primary tables', () => {
  assert.match(presentation, /#rankingWeeklyPanel\s*\{[\s\S]*display:\s*none/);
  assert.match(presentation, /#likesRankingList \.like-rank-item:nth-child\(n \+ 11\)/);
  assert.match(presentation, /\.chart-foot\s*\{[\s\S]*display:\s*none/);
  assert.match(presentation, /#chartLegend span\s*\{[\s\S]*text-overflow:\s*ellipsis/);
  assert.doesNotMatch(presentation, /#tbody|#likesTbody|\.table-wrap\s*\{[^}]*display:\s*none/);
});
