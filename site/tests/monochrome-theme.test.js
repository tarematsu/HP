import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const theme = readFileSync(new URL('../public/monochrome.css', import.meta.url), 'utf8');
const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const dashboardChart = readFileSync(new URL('../public/dashboard-client.js', import.meta.url), 'utf8');
const historyChart = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');

test('dashboard loads the monochrome UI theme', () => {
  assert.match(header, /monochrome\.css\?v=20260919\.3/);
  assert.match(theme, /body\s*\{[\s\S]*--bg:\s*#ffffff[\s\S]*--accent:\s*#111111/);
  assert.match(theme, /\.button\.primary,[\s\S]*background:\s*#111111/);
  assert.match(theme, /\.mode-tabs button\.active,[\s\S]*background:\s*#111111/);
});

test('images are not desaturated by the monochrome theme', () => {
  assert.doesNotMatch(theme, /\bfilter\s*:/);
  assert.doesNotMatch(theme, /(?:\.channel-image|\.track-image|\bimg\b)[^{]*\{[^}]*filter/i);
});

test('canvas graph palette remains sourced from root colors', () => {
  assert.doesNotMatch(theme, /:root\s*\{/);
  assert.match(dashboardChart, /document\.documentElement[\s\S]*getPropertyValue\('--accent'\)/);
  assert.match(historyChart, /getComputedStyle\(document\.documentElement\)/);
  assert.match(theme, /\.legend \.online-key,[\s\S]*color:\s*#d93f79/);
  assert.match(theme, /\.legend \.comment-key\s*\{[\s\S]*color:\s*#168b73/);
  assert.match(theme, /\.legend \.legend-plays\s*\{[\s\S]*color:\s*#6657d8/);
  assert.match(theme, /\.legend \.legend-comments\s*\{[\s\S]*color:\s*#55d6be/);
});
