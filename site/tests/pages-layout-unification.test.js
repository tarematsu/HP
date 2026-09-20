import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/pages-layout-unification.css', import.meta.url), 'utf8');

test('cross-view layout stylesheet is loaded after dashboard refinements', () => {
  assert.match(header, /pages-layout-unification\.css\?v=20260921\.1/);
  assert.ok(
    header.indexOf('currentEnhancementsHref') < header.indexOf('layoutUnificationHref'),
    'layout unification must load after current enhancements',
  );
});

test('mobile navigation stays four columns with a second row for the final three tabs', () => {
  assert.match(css, /#modeTabs\.mode-tabs\.dashboard-tabs[\s\S]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\) !important/);
  assert.match(css, /grid-template-rows:\s*repeat\(2, 32px\) !important/);
});

test('mobile metric goal cannot inherit oversized metric typography', () => {
  assert.match(css, /#metricGoalCompact,[\s\S]*#metricGoalCompact strong,[\s\S]*font-size:\s*10px !important/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*#metricGoalCompact strong,[\s\S]*font-size:\s*8\.5px !important/);
});

test('history and likes tables preserve readable widths on mobile', () => {
  assert.match(css, /#historyView \.table-wrap table[\s\S]*min-width:\s*760px !important/);
  assert.match(css, /#likesView \.table-wrap table[\s\S]*min-width:\s*620px !important/);
  assert.match(css, /\.table-wrap th,[\s\S]*\.table-wrap td[\s\S]*padding:\s*6px 7px !important/);
});

test('cards, controls and section gaps share one visual rhythm', () => {
  assert.match(css, /\.primary-grid,[\s\S]*\.chart-panel,[\s\S]*\.data-panel[\s\S]*margin-top:\s*12px !important/);
  assert.match(css, /\.section-head[\s\S]*margin-bottom:\s*10px !important/);
  assert.match(css, /\.controls[\s\S]*padding:\s*12px 14px !important/);
});
