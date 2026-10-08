import { dashboardRouterSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navigationCss = readFileSync(new URL('../public/dashboard-navigation.css', import.meta.url), 'utf8');
const tabs = dashboardRouterSource();
const stationheadShell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const youtubeRuntime = readFileSync(new URL('../public/youtube-music.js', import.meta.url), 'utf8');

test('source buttons share tap sizing and mobile uses a compact native picker', () => {
  assert.match(navigationCss, /\.dashboard-source-tabs > button,[\s\S]*min-height:\s*44px/);
  assert.match(navigationCss, /\.dashboard-source-tabs > button,[^}]*padding:\s*6px 10px/s);
  assert.match(navigationCss, /@media \(max-width: 760px\)[\s\S]*\.dashboard-source-tabs\.is-multiline\s*\{\s*display: none/);
  assert.match(navigationCss, /\.dashboard-source-picker select\s*\{[^}]*min-height:\s*44px/s);
  assert.match(tabs, /select\.addEventListener\('change'/);
});

test('shared Stationhead broadcast chart and empty state stay inside one chart card', () => {
  const panel = stationheadShell.indexOf('data-stationhead-panel="broadcasts"');
  const chart = stationheadShell.indexOf('class="card chart-card chart-panel"', panel);
  const canvas = stationheadShell.indexOf("role('broadcast-chart')", chart);
  const empty = stationheadShell.indexOf("role('broadcast-chart-empty')", canvas);
  assert.ok(panel >= 0 && chart > panel && canvas > chart && empty > canvas);
  assert.match(tabs, /nogizaka-listening-party-shell\.js\?v=/);
});

test('YouTube Music preserves unknown release fallback', () => {
  assert.match(youtubeRuntime, /text\.toLowerCase\(\) === 'unknown' \? '-' : text/);
  assert.match(youtubeRuntime, /optionalText\(item\.release_type\)/);
});
