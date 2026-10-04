import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const navigationCss = readFileSync(new URL('../public/dashboard-navigation.css', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const stationheadShell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const youtubeRuntime = readFileSync(new URL('../public/youtube-music.js', import.meta.url), 'utf8');

test('responsive source tabs keep usable button sizing', () => {
  assert.match(navigationCss, /\.dashboard-source-tabs > button\s*\{[^}]*min-height:\s*36px[^}]*padding:\s*6px 10px/s);
  assert.match(navigationCss, /@media \(max-width: 760px\)[\s\S]*\.dashboard-source-tabs:not\(\.is-multiline\)/);
  assert.doesNotMatch(navigationCss, /dashboard-source-row/);
});

test('shared Stationhead broadcast chart and empty state stay inside one chart card', () => {
  assert.match(stationheadShell, /data-stationhead-panel="broadcasts"[\s\S]*class="card chart-card chart-panel"[\s\S]*data-role="broadcast-chart"[\s\S]*data-role="broadcast-chart-empty"/);
  assert.match(tabs, /nogizaka-listening-party-shell\.js\?v=/);
});

test('YouTube Music preserves unknown release fallback', () => {
  assert.match(youtubeRuntime, /text\.toLowerCase\(\) === 'unknown' \? '-' : text/);
  assert.match(youtubeRuntime, /optionalText\(item\.release_type\)/);
});
