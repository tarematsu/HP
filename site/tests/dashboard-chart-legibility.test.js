import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sharedCss = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
const firstWeek = readFileSync(new URL('../public/first-week-comparison.js', import.meta.url), 'utf8');
const history = readFileSync(new URL('../public/history/history-period-chart.js', import.meta.url), 'utf8');
const stationhead = readFileSync(new URL('../public/stationhead-channel.js', import.meta.url), 'utf8');

test('fixed-viewBox SVG charts preserve the canonical physical chart typography on narrow screens', () => {
  assert.match(sharedCss, /--dashboard-axis-font-size:\s*11px/);
  assert.match(sharedCss, /--dashboard-svg-visual-scale:\s*1/);
  assert.match(sharedCss, /font-size:\s*calc\(var\(--dashboard-axis-font-size\)\s*\*\s*var\(--dashboard-svg-visual-scale\)\)\s*!important/);
  assert.match(sharedCss, /r:\s*calc\(var\(--dashboard-point-radius\)\s*\*\s*var\(--dashboard-svg-visual-scale\)\)\s*!important/);
  for (const breakpoint of ['760', '640', '560', '480', '400', '340']) assert.match(sharedCss, new RegExp(`@media \\(max-width: ${breakpoint}px\\)`));
  assert.match(sharedCss, /@media \(max-width: 760px\)[\s\S]*--dashboard-label-size:\s*12px/);
  assert.match(sharedCss, /@media \(max-width: 340px\)[\s\S]*--dashboard-svg-visual-scale:\s*3\.15/);
});

test('canvas reference charts keep the same 11px axis baseline used by the shared SVG contract', () => {
  for (const source of [firstWeek, history, stationhead]) assert.match(source, /context\.font\s*=\s*'11px system-ui'/);
});
